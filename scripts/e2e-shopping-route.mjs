import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const appUrl = "http://localhost:8130/tools/shopping-route";
const apiUrl = "http://127.0.0.1:3102";
const outDir = "C:/Users/Administrator/Documents/funbox/docs";
const port = 9400 + Math.floor(Math.random() * 300);
const userData = mkdtempSync(path.join(tmpdir(), "edge-shopping-route-e2e-"));
const username = `138${String(Date.now()).slice(-8)}`;
const password = "password-123";
const displayName = "购物路线测试";

async function api(pathname, options = {}) {
  const response = await fetch(`${apiUrl}${pathname}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${pathname} -> ${response.status} ${JSON.stringify(payload)}`);
  }
  return payload;
}

const session = await api("/api/v1/auth/register", {
  method: "POST",
  body: JSON.stringify({
    username,
    password,
    displayName,
    securityQuestion: "你的第一个绰号是什么？",
    securityAnswer: "小路",
  }),
});
const token = session.accessToken;

const list = await api("/api/v1/shopping-route/lists", {
  method: "POST",
  headers: { Authorization: `Bearer ${token}` },
  body: JSON.stringify({ name: "家庭采购" }),
});
await api(`/api/v1/shopping-route/lists/${list.id}/items`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}` },
  body: JSON.stringify({ name: "西红柿", quantity: "2个" }),
});
await api(`/api/v1/shopping-route/lists/${list.id}/items`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}` },
  body: JSON.stringify({ name: "未归位测试商品", quantity: "1件" }),
});

const store = await api("/api/v1/shopping-route/stores", {
  method: "POST",
  headers: { Authorization: `Bearer ${token}` },
  body: JSON.stringify({ name: "常去超市", address: "测试路 1 号" }),
});
const zones = await api(`/api/v1/shopping-route/stores/${store.id}/zones`, {
  method: "PUT",
  headers: { Authorization: `Bearer ${token}` },
  body: JSON.stringify([
    { name: "蔬菜区", zoneType: "produce" },
    { name: "日用品区", zoneType: "household" },
  ]),
});
const produceZone = zones.items.find((zone) => zone.zoneType === "produce");

const listDetail = await api(`/api/v1/shopping-route/lists/${list.id}`, {
  headers: { Authorization: `Bearer ${token}` },
});
const tomato = listDetail.items.find((item) => item.name === "西红柿");
await api("/api/v1/shopping-route/mappings", {
  method: "POST",
  headers: { Authorization: `Bearer ${token}` },
  body: JSON.stringify({
    itemId: tomato.id,
    storeId: store.id,
    zoneId: produceZone.id,
  }),
});
const route = await api("/api/v1/shopping-route/routes", {
  method: "POST",
  headers: { Authorization: `Bearer ${token}` },
  body: JSON.stringify({ listId: list.id, storeId: store.id }),
});
if (route.mappedCount !== 1 || route.unmappedCount !== 1) {
  throw new Error(`unexpected route counts: ${JSON.stringify(route)}`);
}

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
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} -> ${response.status}`);
  return response.json();
}

async function waitForTarget() {
  for (let index = 0; index < 60; index++) {
    try {
      const pages = await getJson(`http://127.0.0.1:${port}/json/list`);
      const page = pages.find((item) => item.type === "page");
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
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(JSON.stringify(message.error)));
    else resolve(message.result);
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
  return result.result?.value;
}

await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: 430,
  height: 900,
  deviceScaleFactor: 1,
  mobile: true,
});
await send("Page.navigate", { url: appUrl });
for (let index = 0; index < 90; index++) {
  await sleep(500);
  const location = await evaluate("location.href");
  const body = await evaluate("(document.body ? document.body.innerText : '').slice(0, 80)");
  if (location.startsWith("http://localhost:8130") && body.length > 0) break;
}
await evaluate(`localStorage.setItem('funbox.auth.access-token.v1', ${JSON.stringify(token)})`);
await send("Page.reload", { ignoreCache: true });
for (let index = 0; index < 120; index++) {
  await sleep(500);
  const body = await evaluate("(document.body ? document.body.innerText : '')");
  if (body.includes("购物路线") && !body.includes("登录后使用购物路线")) break;
}
const initialText = await evaluate("document.body.innerText");
if (!initialText.includes("购物路线")) {
  throw new Error("购物路线 page did not render");
}

const clicked = await evaluate(`(() => {
  const candidates = [...document.querySelectorAll('*')];
  const target = candidates.find((el) => {
    const text = (el.textContent || '').trim();
    return text === '路线' && el.children.length === 0;
  });
  if (!target) return false;
  target.click();
  return true;
})()`);
if (!clicked) {
  throw new Error("could not click route tab");
}
await sleep(3000);

const routeText = await evaluate("document.body.innerText");
const checks = [
  "购物路线",
  "蔬菜区",
  "未归位",
  "未归位测试商品",
];
for (const check of checks) {
  if (!routeText.includes(check)) {
    throw new Error(`route UI missing ${check}`);
  }
}

const shot = await send("Page.captureScreenshot", {
  format: "png",
  captureBeyondViewport: false,
});
writeFileSync(path.join(outDir, "shopping-route-e2e.png"), Buffer.from(shot.data, "base64"));

console.log(JSON.stringify({
  username,
  listId: list.id,
  storeId: store.id,
  routeId: route.id,
  mappedCount: route.mappedCount,
  unmappedCount: route.unmappedCount,
  uiChecks: checks.length,
  screenshot: "shopping-route-e2e.png",
}, null, 2));

ws.close();
child.kill();
await sleep(500);
rmSync(userData, { recursive: true, force: true });
