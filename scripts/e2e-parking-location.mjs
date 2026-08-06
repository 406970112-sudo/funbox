import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const outDir = "C:/Users/Administrator/Documents/funbox/docs";
const appURL = "http://127.0.0.1:8081/tools/parking-location";
const port = 9500 + Math.floor(Math.random() * 400);
const userData = mkdtempSync(path.join(tmpdir(), "edge-parking-e2e-"));

const child = spawn(
  edgePath,
  [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    "--no-sandbox",
    "--no-proxy-server",
    "--disable-features=BlockInsecurePrivateNetworkRequests",
    "--window-size=430,900",
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
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    throw new Error(JSON.stringify(result.exceptionDetails));
  }
  return result.result.value;
}

async function waitForText(text, timeoutMs = 90000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const body = await evaluate("document.body?.innerText || ''");
    if (body.includes(text)) return body;
    await sleep(1000);
  }
  const body = await evaluate("document.body?.innerText || ''");
  throw new Error(`timeout waiting for text ${text}; body=${body.slice(0, 500)}`);
}

async function clickText(text) {
  const clicked = await evaluate(`(() => {
    const nodes = [...document.querySelectorAll('div, button, span, [role="button"]')];
    const node = nodes.find((item) =>
      item.offsetParent !== null &&
      (item.textContent || '').trim() === ${JSON.stringify(text)}
    );
    if (!node) return false;
    node.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`button not found: ${text}`);
}

async function fillPlaceholder(placeholder, value) {
  const filled = await evaluate(`(() => {
    const input = [...document.querySelectorAll('input, textarea')].find((item) =>
      (item.placeholder || '').includes(${JSON.stringify(placeholder)})
    );
    if (!input) return false;
    const proto = input.tagName === 'TEXTAREA'
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  if (!filled) throw new Error(`input not found: ${placeholder}`);
}

async function screenshot(name) {
  const shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(path.join(outDir, name), Buffer.from(shot.data, "base64"));
}

await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: 430,
  height: 900,
  deviceScaleFactor: 1,
  mobile: true,
});
await send("Page.navigate", { url: appURL });

await waitForText("停车位置记录");
await waitForText("还没有停车记录");
await screenshot("parking-location-e2e-home.png");

await clickText("开始记录");
await waitForText("记录本次停车");
await fillPlaceholder("输入真实停车场名称", "成都新世纪环球中心");
await fillPlaceholder("B3", "B3");
await fillPlaceholder("C区", "C区");
await fillPlaceholder("328号", "328号");
await fillPlaceholder("例如：靠近蓝色电梯", "靠近蓝色电梯");
await clickText("保存真实记录");

await waitForText("停车中");
await waitForText("成都新世纪环球中心");
await screenshot("parking-location-e2e-detail.png");

await clickText("已取车");
await waitForText("取车确认");
await fillPlaceholder("如实填写，可空", "10");
await clickText("确认取车");

await waitForText("停车记录");
await waitForText("已取车");
await screenshot("parking-location-e2e-leave.png");

console.log(JSON.stringify({ status: "ok", home: "home.png", detail: "detail.png", leave: "leave.png" }, null, 2));

ws.close();
child.kill();
await sleep(500);
rmSync(userData, { recursive: true, force: true });
