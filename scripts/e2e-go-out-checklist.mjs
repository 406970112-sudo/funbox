import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const external = process.env.E2E_EXTERNAL === "1";
const apiBase = process.env.E2E_BACKEND_BASE || "http://127.0.0.1:3000";
const appBase = process.env.E2E_APP_BASE || "http://127.0.0.1:8084";
const username = `138${String(Date.now()).slice(-8)}`;
const password = "password-123";
const backend = external
  ? null
  : spawn("go.exe", ["run", "./cmd/api"], {
      cwd: "C:/Users/Administrator/Documents/funbox/backend",
      stdio: "ignore",
    });
const staticServerScript = "C:/Users/Administrator/Documents/funbox/scripts/serve-static-spa.mjs";
const staticServer = external
  ? null
  : spawn(process.execPath, [staticServerScript], { stdio: "ignore" });

async function waitForBackend() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${apiBase}/healthz`);
      if (res.ok) return;
    } catch {
      // Backend is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("backend did not start");
}

await waitForBackend();

async function waitForStaticServer() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(appBase);
      if (res.ok) return;
    } catch {
      // Static server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("static server did not start");
}

await waitForStaticServer();

async function createUser() {
  const response = await fetch(`${apiBase}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username,
      password,
      displayName: "出门清单测试",
      securityQuestion: "你的第一个绰号是什么？",
      securityAnswer: "小出",
    }),
  });
  if (!response.ok) {
    throw new Error(`register failed: ${response.status} ${await response.text()}`);
  }
  const session = await response.json();
  return session.accessToken;
}

const token = await createUser();
const port = 9700 + Math.floor(Math.random() * 200);
const userData = mkdtempSync(path.join(tmpdir(), "edge-go-out-e2e-"));
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
    throw new Error(result.exceptionDetails.text || "evaluate failed");
  }
  return result.result.value;
}

async function waitForExpression(expression, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const value = await evaluate(expression);
      if (value) return value;
    } catch {
      // Page may still be navigating.
    }
    await sleep(500);
  }
  const debug = await evaluate(`JSON.stringify({ href: location.href, body: document.body.innerText.slice(0, 300) })`);
  throw new Error(`waitForExpression timed out: ${expression}; debug=${debug}`);
}

await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: 430,
  height: 900,
  deviceScaleFactor: 1,
  mobile: true,
});
await send("Page.navigate", { url: appBase });
await waitForExpression(`location.protocol === 'http:' && document.readyState === 'complete' && document.body.innerText.length > 0`);

await evaluate(`localStorage.setItem('funbox.auth.access-token.v1', ${JSON.stringify(token)}); true`);
await send("Page.navigate", { url: `${appBase}/tools/go-out-checklist` });
await waitForExpression(`location.pathname === '/tools/go-out-checklist' && document.body.innerText.includes('出门检查清单')`);

const initialText = await evaluate(`document.body.innerText`);
if (!initialText.includes("出门检查清单")) {
  throw new Error("tool page did not load");
}

const openScenes = await evaluate(`(() => {
  const buttons = [...document.querySelectorAll('[role="button"]')];
  const target = buttons.find((el) => el.textContent.includes('场景') && el.textContent.length < 20);
  if (!target) return false;
  target.click();
  return true;
})()`);
if (!openScenes) throw new Error(`scenes tab not found; body=${JSON.stringify(initialText.slice(0, 300))}`);
await waitForExpression(`document.body.innerText.includes('模板库') && document.body.innerText.includes('使用模板')`);

const applyTemplate = await evaluate(`(() => {
  const buttons = [...document.querySelectorAll('[role="button"], button')];
  const target = buttons.find((el) => el.textContent.includes('使用模板'));
  if (!target) {
    const textEl = [...document.querySelectorAll('*')].find((el) => el.children.length === 0 && el.textContent.trim() === '使用模板');
    if (!textEl) return false;
    const clickable = textEl.closest('[role="button"], button') || textEl.parentElement;
    if (!clickable) return false;
    clickable.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return true;
  }
  target.click();
  return true;
})()`);
if (!applyTemplate) throw new Error(`template button not found; body=${JSON.stringify((await evaluate(`document.body.innerText`)).slice(0, 400))}`);
await sleep(2500);

const openCheck = await evaluate(`(() => {
  const buttons = [...document.querySelectorAll('[role="button"]')];
  const target = buttons.find((el) => el.textContent.includes('检查') && el.textContent.length < 20);
  if (!target) return false;
  target.click();
  return true;
})()`);
if (!openCheck) throw new Error("check tab not found");
await waitForExpression(`document.body.innerText.includes('确认全部已带')`);

const itemNames = ["手机", "钥匙", "工牌", "耳机"];
let clicked = 0;
for (const name of itemNames) {
  const point = await evaluate(`(() => {
    const textEl = [...document.querySelectorAll('*')].find((el) => el.children.length === 0 && el.textContent.trim() === name);
    const clickable = textEl?.closest('[role="button"], button') || textEl?.parentElement?.parentElement || textEl?.parentElement;
    if (!clickable) return null;
    clickable.scrollIntoView({ block: "center" });
    const rect = clickable.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`);
  if (point) {
    await sleep(150);
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
    await evaluate(`(() => {
      const textEl = [...document.querySelectorAll('*')].find((el) => el.children.length === 0 && el.textContent.trim() === ${JSON.stringify(name)});
      const clickable = textEl?.closest('[role="button"], button') || textEl?.parentElement?.parentElement || textEl?.parentElement;
      if (!clickable) return false;
      clickable.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0 }));
      clickable.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0 }));
      clickable.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      return true;
    })()`);
    clicked++;
  }
  await sleep(300);
}
if (clicked !== itemNames.length) throw new Error(`clicked ${clicked} items, expected ${itemNames.length}; body=${JSON.stringify((await evaluate(`document.body.innerText`)).slice(0, 500))}`);
await sleep(700);

const confirm = await evaluate(`(() => {
  const buttons = [...document.querySelectorAll('[role="button"]')];
  const target = buttons.find((el) => el.textContent.includes('确认全部已带'));
  if (!target) return false;
  target.click();
  return true;
})()`);
if (!confirm) throw new Error("confirm button not found");
await sleep(2500);

const successText = await evaluate(`document.body.innerText`);
if (!successText.includes("今日出门检查完成，没有遗漏。")) {
  const itemDebug = await evaluate(`(() => {
    const textEl = [...document.querySelectorAll('*')].find((el) => el.children.length === 0 && el.textContent.trim() === '手机');
    const chain = [];
    let node = textEl;
    for (let i = 0; i < 6 && node; i++, node = node.parentElement) {
      chain.push({ tag: node.tagName, role: node.getAttribute?.('role'), cls: String(node.className || '').slice(0, 90), text: String(node.textContent || '').trim().slice(0, 40) });
    }
    return JSON.stringify(chain);
  })()`);
  throw new Error(`completion feedback not shown; body=${JSON.stringify(successText.slice(0, 600))}; itemDebug=${itemDebug}`);
}

const historyTab = await evaluate(`(() => {
  const buttons = [...document.querySelectorAll('[role="button"]')];
  const target = buttons.find((el) => el.textContent.includes('历史') && el.textContent.length < 20);
  if (!target) return false;
  target.click();
  return true;
})()`);
if (!historyTab) throw new Error("history tab not found");
await sleep(1500);
const historyText = await evaluate(`document.body.innerText`);
if (!historyText.includes("今日出门检查完成，没有遗漏。")) {
  throw new Error("history record not shown");
}

const shot = await send("Page.captureScreenshot", {
  format: "png",
  captureBeyondViewport: false,
});
writeFileSync(
  "C:/Users/Administrator/Documents/funbox/docs/go-out-checklist-e2e.png",
  Buffer.from(shot.data, "base64")
);

console.log(JSON.stringify({
  username,
  appliedTemplate: true,
  clickedItems: clicked,
  confirmed: true,
  successTextShown: true,
  historyShown: true,
  screenshot: "docs/go-out-checklist-e2e.png",
}, null, 2));

ws.close();
child.kill();
if (staticServer) staticServer.kill();
if (backend) backend.kill();
await sleep(500);
rmSync(userData, { recursive: true, force: true });
