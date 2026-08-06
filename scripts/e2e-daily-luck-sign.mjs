import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const appURL = "http://127.0.0.1:8090/tools/daily-luck-sign";
const outDir = "C:/Users/Administrator/Documents/funbox/docs";
const port = 9600 + Math.floor(Math.random() * 300);
const userData = mkdtempSync(path.join(tmpdir(), "edge-daily-luck-sign-e2e-"));

const child = spawn(
  edgePath,
  [
    "--headless",
    "--disable-gpu",
    "--disable-software-rasterizer",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    "--no-sandbox",
    "--window-size=430,932",
    `--remote-debugging-port=${port}`,
    "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${userData}`,
    "about:blank",
  ],
  { stdio: "ignore" }
);
child.on("exit", (code, signal) => {
  console.log("EDGE_EXIT", code, signal);
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

async function waitForTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const pages = await getJson(`http://127.0.0.1:${port}/json/list`);
      const page = pages.find((p) => p.type === "page");
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      // Edge is still starting.
    }
    await sleep(200);
  }
  throw new Error("Edge DevTools endpoint did not start");
}

const wsUrl = await waitForTarget();
const ws = new WebSocket(wsUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});

let nextId = 1;
const pending = new Map();

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
  }
};
ws.onclose = () => {
  console.log("WS_CLOSE");
};
ws.onerror = (error) => {
  console.log("WS_ERROR", error?.message || String(error));
};

function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(JSON.stringify(result.exceptionDetails));
  }
  return result.result.value;
}

async function waitFor(expression, timeout = 90000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      if (await evaluate(expression)) return;
    } catch {
      // page is still evaluating
    }
    await sleep(500);
  }
  throw new Error(`waitFor timeout: ${expression}`);
}

async function shot(name) {
  const shot = await send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  writeFileSync(path.join(outDir, name), Buffer.from(shot.data, "base64"));
}

await send("Page.enable");
await send("Log.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: 430,
  height: 932,
  deviceScaleFactor: 1,
  mobile: true,
});
await send("Page.navigate", { url: appURL });
try {
  await waitFor(`document.body && document.body.innerText.includes('今日运气签')`, 60000);
} catch (error) {
  console.log("PAGE_URL", await evaluate(`location.href`));
  console.log("PAGE_TEXT", await evaluate(`document.body ? document.body.innerText.slice(0, 3000) : 'NO BODY'`));
  console.log("PAGE_HTML", await evaluate(`document.body ? document.body.innerHTML.slice(0, 1000) : 'NO BODY'`));
  throw error;
}
try {
  await waitFor(`document.body.innerText.includes('还没有选择城市')`, 60000);
} catch (error) {
  console.log("PAGE_TEXT", await evaluate(`document.body.innerText.slice(0, 2000)`));
  throw error;
}
await shot("daily-luck-sign-e2e-onboarding.png");

await evaluate(`(() => {
  const input = document.querySelector('input[placeholder*="搜索城市"]');
  if (!input) throw new Error('search input missing');
  input.focus();
  return true;
})()`);
await send("Input.insertText", { text: "上海" });
await evaluate(`(() => {
  const input = document.querySelector('input[placeholder*="搜索城市"]');
  const button = input?.parentElement?.querySelector('[role="button"]');
  button?.click();
  return Boolean(button);
})()`);
try {
  await waitFor(`document.body.innerText.includes('上海市')`, 60000);
} catch (error) {
  console.log("SEARCH_TEXT", await evaluate(`document.body.innerText.slice(0, 2000)`));
  throw error;
}
await evaluate(`(() => {
  const buttons = [...document.querySelectorAll('[role="button"]')];
  const result = buttons.find((item) => item.innerText.includes('上海'));
  if (!result) throw new Error('city result missing');
  result.click();
  return true;
})()`);
await waitFor(`document.body.innerText.includes('今日灵感色')`, 60000);
await waitFor(`document.body.innerText.includes('完整可用')`, 60000);
await sleep(1500);
await shot("daily-luck-sign-e2e-home.png");

const homeState = await evaluate(`(() => {
  const text = document.body.innerText;
  return {
    hasColor: text.includes('今日灵感色'),
    hasWeather: text.includes('最高 / 最低') || text.includes('降雨概率'),
    hasSuggestions: text.includes('今日小事') || text.includes('今日挑战'),
    hasCompleteStatus: text.includes('完整可用'),
    city: text.includes('上海市'),
  };
})()`);
console.log("HOME_STATE", JSON.stringify(homeState));

await evaluate(`(() => {
  const buttons = [...document.querySelectorAll('[role="button"]')];
  const action = buttons.find((item) => item.innerText.trim() === '行动');
  action?.click();
  return true;
})()`);
await waitFor(`document.body.innerText.includes('真实依据') || document.body.innerText.includes('expandable')`, 30000);
await shot("daily-luck-sign-e2e-actions.png");

await evaluate(`(() => {
  const buttons = [...document.querySelectorAll('[role="button"]')];
  const detail = buttons.find((item) => item.innerText.trim() === '明细');
  detail?.click();
  return true;
})()`);
await waitFor(`document.body.innerText.includes('Open-Meteo Forecast')`, 30000);
await shot("daily-luck-sign-e2e-detail.png");

await evaluate(`(() => {
  const buttons = [...document.querySelectorAll('[role="button"]')];
  const action = buttons.find((item) => item.innerText.trim() === '行动');
  action?.click();
  return true;
})()`);
await waitFor(`document.body.innerText.includes('今日挑战')`, 30000);

await evaluate(`(() => {
  const buttons = [...document.querySelectorAll('[role="button"]')];
  const complete = buttons.find((item) => item.innerText.includes('完成') && item.innerText.length < 8);
  complete?.click();
  return true;
})()`);
await sleep(800);

await evaluate(`(() => {
  const buttons = [...document.querySelectorAll('[role="button"]')];
  const history = buttons.find((item) => item.innerText.trim() === '完成');
  history?.click();
  return true;
})()`);
await waitFor(`document.body.innerText.includes('还没有完成记录') || document.body.innerText.includes('累计完成')`, 30000);
const historyState = await evaluate(`(() => ({
  hasStats: document.body.innerText.includes('今日完成'),
  hasRecord: !document.body.innerText.includes('还没有完成记录'),
}))()`);
console.log("HISTORY_STATE", JSON.stringify(historyState));
await shot("daily-luck-sign-e2e-history.png");

const consoleState = await evaluate(`(() => ({
  hasTabText: document.body.innerText.includes('今日运气签'),
  hasHistoryText: document.body.innerText.includes('今日完成'),
}))()`);
console.log("CONSOLE_STATE", JSON.stringify(consoleState));

ws.close();
child.kill();
await sleep(500);
rmSync(userData, { recursive: true, force: true });
