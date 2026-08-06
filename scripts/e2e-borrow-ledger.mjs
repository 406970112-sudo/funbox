import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const appUrl = "http://localhost:8090/tools/borrow-ledger";
const outDir = "C:/Users/Administrator/Documents/funbox/docs";
const port = 9800 + Math.floor(Math.random() * 300);
const userData = mkdtempSync(path.join(tmpdir(), "edge-borrow-ledger-e2e-"));

const child = spawn(
  edgePath,
  [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
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

async function evaluate(expression) {
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

async function waitForText(text, timeout = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const found = await evaluate(
      `document.body.innerText.includes(${JSON.stringify(text)})`
    );
    if (found) return true;
    await sleep(400);
  }
  const body = await evaluate("document.body.innerText.slice(0, 2000)");
  throw new Error(`Timed out waiting for text: ${text}; body=${JSON.stringify(body)}`);
}

async function clickText(text) {
  const clicked = await evaluate(`(() => {
    const el = [...document.querySelectorAll('[role="button"], button')]
      .find((node) => (node.innerText || '').trim().includes(${JSON.stringify(text)}));
    if (!el) return false;
    el.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Button not found: ${text}`);
  await sleep(500);
}

async function setInput(label, value) {
  const ok = await evaluate(`(() => {
    const el = document.querySelector('[aria-label=${JSON.stringify(label)}]');
    if (!el) return false;
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  if (!ok) throw new Error(`Input not found: ${label}`);
  await sleep(200);
}

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: 430,
  height: 900,
  deviceScaleFactor: 1,
  mobile: true,
});
await send("Page.navigate", { url: appUrl });
await waitForText("还没有真实借还记录", 30000);

const emptyText = await evaluate("document.body.innerText");
if (!emptyText.includes("还没有真实借还记录")) {
  throw new Error("Empty state did not render");
}

await clickText("记一笔");
await waitForText("保存真实记录");
await setInput("人员姓名或称呼", "阿哲");
await setInput("物品名称", "充电器");
await setInput("日期", new Date().toISOString().slice(0, 10));
await setInput("约定日期", "2026-08-20");
await clickText("提前 3 天");
await clickText("保存真实记录");
await waitForText("1 笔进行中");

const homeShot = await send("Page.captureScreenshot", {
  format: "png",
  captureBeyondViewport: true,
});
writeFileSync(path.join(outDir, "borrow-ledger-e2e-home.png"), Buffer.from(homeShot.data, "base64"));

await clickText("提醒");
await waitForText("轻松提醒");
const reminderText = await evaluate("document.body.innerText");
await clickText("历史");
await waitForText("充电器");

const finalText = await evaluate("document.body.innerText");
const result = {
  ok: true,
  hasEmptyState: emptyText.includes("还没有真实借还记录"),
  hasSavedRecord: finalText.includes("充电器"),
  hasReminder: reminderText.includes("轻松提醒"),
  hasHistory: finalText.includes("阿哲"),
};
console.log(JSON.stringify(result, null, 2));

ws.close();
child.kill();
await sleep(500);
rmSync(userData, { recursive: true, force: true });
