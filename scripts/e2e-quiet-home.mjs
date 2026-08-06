import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const appUrl = "http://127.0.0.1:8081";
const port = 9800 + Math.floor(Math.random() * 100);
const userData = mkdtempSync(path.join(tmpdir(), "edge-quiet-home-e2e-"));

const child = spawn(
  edgePath,
  [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=msEdgeSidebarV2",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userData}`,
    "about:blank",
  ],
  { stdio: "ignore" }
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

async function waitForTarget() {
  for (let i = 0; i < 80; i++) {
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

function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evalValue(expression) {
  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || "evaluate failed");
  }
  return result.result?.value;
}

async function waitForText(text, timeoutMs = 60000) {
  const started = Date.now();
  let body = "";
  while (Date.now() - started < timeoutMs) {
    body = await evalValue("document.body.innerText");
    if (body && body.includes(text)) return body;
    await sleep(500);
  }
  throw new Error(`等待文本超时: ${text}\n页面内容: ${body}`);
}

async function clickText(text) {
  const clicked = await evalValue(`(() => {
    const nodes = [...document.querySelectorAll('div,span,button')];
    const node = nodes.find((el) => el.textContent && el.textContent.trim() === ${JSON.stringify(text)});
    if (!node) return false;
    const target = node.closest('[role="button"],button') || node;
    target.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`未找到可点击文本: ${text}`);
  await sleep(400);
}

async function clickContains(text) {
  const clicked = await evalValue(`(() => {
    const nodes = [...document.querySelectorAll('div,span,button')];
    const node = nodes.find((el) => el.textContent && el.textContent.trim().includes(${JSON.stringify(text)}));
    if (!node) return false;
    const target = node.closest('[role="button"],button') || node;
    target.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`未找到包含文本的可点击节点: ${text}`);
  await sleep(400);
}

async function fillPlaceholder(placeholder, value) {
  const filled = await evalValue(`(() => {
    const input = [...document.querySelectorAll('input')].find((el) => el.placeholder === ${JSON.stringify(placeholder)});
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  if (!filled) throw new Error(`未找到输入框: ${placeholder}`);
  await sleep(150);
}

async function assertTrue(condition, message) {
  if (!condition) throw new Error(message);
}

await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: 390,
  height: 844,
  deviceScaleFactor: 1,
  mobile: true,
});

console.log("导航到安静到家工具页");
await send("Page.navigate", { url: `${appUrl}/tools/quiet-home` });
const emptyBody = await waitForText("还没有到家行程", 90000);
assertTrue(emptyBody.includes("安静到家"), "安静到家标题未显示");
assertTrue(emptyBody.includes("首次使用不会预置示例行程"), "空态未提示无预置数据");

console.log("创建真实到家行程");
await clickText("创建");
await waitForText("开始本次行程", 15000);
await fillPlaceholder("输入真实出发地点", "公司");
await fillPlaceholder("输入到达地点，例如我的家", "我的家");
const eta = new Date(Date.now() + 60 * 60 * 1000);
const etaValue = `${eta.getFullYear()}-${String(eta.getMonth() + 1).padStart(2, "0")}-${String(eta.getDate()).padStart(2, "0")} ${String(eta.getHours()).padStart(2, "0")}:${String(eta.getMinutes()).padStart(2, "0")}`;
await fillPlaceholder("2026-08-06 23:20", etaValue);
await clickText("开始本次行程");
const activeBody = await waitForText("我已到家", 20000);
assertTrue(activeBody.includes("预计到家时间"), "行程进行中未显示预计时间");
assertTrue(activeBody.includes("默认不读取位置") || activeBody.includes("仅本次到达检测"), "隐私状态未显示");

console.log("点击报平安");
await clickText("我已到家");
const checkBody = await waitForText("已到家，平安", 20000);
assertTrue(checkBody.includes("比预计"), "报平安结果未显示真实时间差异");

console.log("查看真实历史");
await clickText("历史");
const historyBody = await waitForText("到家", 20000);
assertTrue(historyBody.includes("公司 → 我的家"), "历史未显示真实行程");

console.log("E2E 通过");
ws.close();
child.kill();
await sleep(500);
rmSync(userData, { recursive: true, force: true });
