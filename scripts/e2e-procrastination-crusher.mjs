import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const appUrl = process.env.APP_URL || "http://127.0.0.1:8087/tools/procrastination-crusher";
const token = process.env.TOKEN;
if (!token) throw new Error("TOKEN env is required");

const port = 9300 + Math.floor(Math.random() * 500);
const userData = mkdtempSync(path.join(tmpdir(), "edge-procrastinator-final-"));
const child = spawn(edgePath, [
  "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
  "--no-default-browser-check", `--remote-debugging-port=${port}`,
  `--user-data-dir=${userData}`, "about:blank",
], { stdio: "ignore" });

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
    } catch {}
    await sleep(200);
  }
  throw new Error("Edge target did not start");
}

const wsUrl = await waitForTarget();
const ws = new WebSocket(wsUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 1;
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
  const requestId = id++;
  return new Promise((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
    ws.send(JSON.stringify({ id: requestId, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}
async function waitForText(text, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const body = await evaluate("document.body?.innerText || ''");
    if (body.includes(text)) return body;
    await sleep(1000);
  }
  const body = await evaluate("document.body?.innerText || ''");
  throw new Error(`timed out waiting for ${text}; body=${body.slice(0, 1500)}`);
}

await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 430, height: 900, deviceScaleFactor: 1, mobile: true });
await send("Page.navigate", { url: appUrl });
await waitForText("登录后使用拖延任务粉碎机", 120000);
await evaluate(`localStorage.setItem('funbox.auth.access-token.v1', ${JSON.stringify(token)}); true`);
await send("Page.reload", { ignoreCache: true });
await waitForText("整理房间", 120000);
const homeText = await evaluate("document.body.innerText");
const homePass = homeText.includes("现在只做这一步") && homeText.includes("整理房间");

await evaluate(`(() => {
  const target = [...document.querySelectorAll('[role="button"]')]
    .find((el) => el.innerText.includes('整理房间') && el.innerText.includes('0/2') && el.innerText.includes('+38 XP') && el.offsetParent !== null);
  if (target) target.click();
  return Boolean(target);
})()`);
await waitForText("步骤列表", 30000);

await evaluate(`(() => {
  const target = [...document.querySelectorAll('[role="button"]')]
    .find((el) => el.innerText.includes('完成这一步') && el.offsetParent !== null);
  if (target) target.click();
  return Boolean(target);
})()`);
await waitForText("撤销", 30000);
const detailText = await evaluate("document.body.innerText");
const stepPass = detailText.includes("撤销") && detailText.includes("只把桌上的垃圾扔掉");

await evaluate(`(() => {
  const target = [...document.querySelectorAll('[role="button"]')]
    .find((el) => el.innerText.includes('经验账本') && el.offsetParent !== null);
  if (target) target.click();
  return Boolean(target);
})()`);
await waitForText("经验账本", 30000);
await sleep(1500);
const ledgerText = await evaluate("document.body.innerText");
const ledgerPass = ledgerText.includes("经验账本") && ledgerText.includes("8 XP");

const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(path.join("docs", "procrastination-crusher-e2e.png"), Buffer.from(shot.data, "base64"));
console.log(JSON.stringify({ homePass, stepPass, ledgerPass }, null, 2));
if (!homePass || !stepPass || !ledgerPass) process.exitCode = 1;
ws.close();
child.kill();
try {
  rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
} catch {}
