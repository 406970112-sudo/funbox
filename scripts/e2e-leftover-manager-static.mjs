import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const distDir = "C:/Users/Administrator/Documents/funbox/.worktrees/leftover-manager-v2/frontend/dist-leftover";
const appUrl = "http://127.0.0.1:8094";
const port = 9900 + Math.floor(Math.random() * 100);
const userData = mkdtempSync(path.join(tmpdir(), "edge-leftover-static-e2e-"));

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

const staticServer = createServer((request, response) => {
  const url = new URL(request.url ?? "/", appUrl);
  let filePath = path.join(distDir, url.pathname === "/" ? "index.html" : url.pathname);
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = path.join(distDir, "index.html");
  }
  const ext = path.extname(filePath).toLowerCase();
  response.writeHead(200, { "Content-Type": mime[ext] ?? "application/octet-stream" });
  response.end(readFileSync(filePath));
});

await new Promise((resolve) => staticServer.listen(8094, "127.0.0.1", resolve));

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

async function waitForText(text, timeoutMs = 45000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const body = await evalValue("document.body.innerText");
    if (body && body.includes(text)) return body;
    await sleep(500);
  }
  const body = await evalValue("document.body.innerText");
  throw new Error(`等待文本超时: ${text}\n${String(body || '').slice(0, 600)}`);
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

async function clickAriaLabel(label) {
  const clicked = await evalValue(`(() => {
    const node = document.querySelector('[aria-label=${JSON.stringify(label)}]');
    if (!node) return false;
    node.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`未找到无障碍标签: ${label}`);
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

console.log("静态服务端到端：导航到冰箱剩菜管家");
await send("Page.navigate", { url: `${appUrl}/tools/leftover-manager` });
const emptyBody = await waitForText("冰箱剩菜管家", 60000);
assertTrue(emptyBody.includes("本机真实数据"), `本机真实数据提示未显示: ${String(emptyBody).slice(0, 600)}`);
assertTrue(emptyBody.includes("还没有待处理记录"), "空态未显示");

console.log("添加真实剩菜");
await clickAriaLabel("添加记录");
await waitForText("添加记录", 15000);
await fillPlaceholder("请输入真实菜名", "昨天的红烧肉");
await fillPlaceholder("2026-08-07T20:00", "2026-08-07T20:00");
await fillPlaceholder("0.00", "18");
await clickText("保存记录");
const savedBody = await waitForText("优先吃掉", 15000);
assertTrue(savedBody.includes("昨天的红烧肉"), "保存后未显示红烧肉");

console.log("添加食材并验证今晚建议");
await clickAriaLabel("添加记录");
await waitForText("添加记录", 15000);
await clickText("食材");
await fillPlaceholder("请输入真实菜名", "西红柿");
await fillPlaceholder("2026-08-07T20:00", "2026-08-07T20:00");
await clickText("保存记录");
await waitForText("西红柿", 15000);

await clickAriaLabel("添加记录");
await waitForText("添加记录", 15000);
await clickText("食材");
await fillPlaceholder("请输入真实菜名", "鸡蛋");
await fillPlaceholder("2026-08-07T20:00", "2026-08-07T20:00");
await clickText("保存记录");
const suggestionBody = await waitForText("西红柿炒鸡蛋", 15000);
assertTrue(suggestionBody.includes("今晚建议"), "今晚建议未显示");
assertTrue(suggestionBody.includes("100%"), "匹配度未显示");

console.log("标记吃完并查看历史");
await clickText("昨天的红烧肉");
await waitForText("预计食用期限", 15000);
await clickText("标记吃完");
await waitForText("已标记吃完", 15000);
await clickText("历史");
const historyBody = await waitForText("真实动作记录", 15000);
assertTrue(historyBody.includes("已吃完"), "历史未显示已吃完动作");
assertTrue(historyBody.includes("红烧肉"), "历史未显示红烧肉");

console.log("静态 E2E 通过");
ws.close();
child.kill();
await sleep(500);
rmSync(userData, { recursive: true, force: true });
staticServer.close();
