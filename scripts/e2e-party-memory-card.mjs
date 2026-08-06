import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const appURL = "http://localhost:8085/tools/party-memory-card";
const credentials = readFileSync(
  "C:/Users/Administrator/Documents/funbox/backend/party-test-credentials.txt",
  "utf8",
);
const token = /TOKEN=(.+)/.exec(credentials)?.[1]?.trim();
if (!token) throw new Error("test token missing");

const port = 9900 + Math.floor(Math.random() * 500);
const userData = mkdtempSync(path.join(tmpdir(), "edge-party-e2e-"));
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
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: 430,
  height: 932,
  deviceScaleFactor: 1,
  mobile: true,
});
await send("Page.navigate", { url: appURL });
await sleep(7000);
const tokenSet = await evaluate(`
  localStorage.setItem('funbox.auth.access-token.v1', ${JSON.stringify(token)});
  localStorage.getItem('funbox.auth.access-token.v1');
`);
if (tokenSet !== token) throw new Error(`token not persisted: ${tokenSet}`);
await send("Page.reload");
await sleep(7000);

async function waitForText(text, timeout = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const found = await evaluate(`document.body.innerText.includes(${JSON.stringify(text)})`);
    if (found) return true;
    await sleep(500);
  }
  const body = await evaluate("document.body.innerText");
  throw new Error(`timeout waiting for text: ${text}\n${body.slice(0, 1200)}`);
}

await waitForText("还没有聚会记忆卡");
await evaluate(`
  (() => {
    const button = document.querySelector('[aria-label="记录聚会"]');
    if (button) button.click();
    return Boolean(button);
  })()
`);
await sleep(1200);
await evaluate(`
  (() => {
    const setValue = (selector, value) => {
      const el = document.querySelector(selector);
      if (!el) return false;
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    };
    setValue('input[placeholder="真实餐厅或地点名称"]', '川香居');
    setValue('input[placeholder="真实地址"]', '滨江路 18 号');
    setValue('input[placeholder="输入真实姓名或昵称"]', '王明');
    return true;
  })()
`);
await evaluate(`
  (() => {
    const button = document.querySelector('[aria-label="添加参与人"]');
    if (button) button.click();
    return Boolean(button);
  })()
`);
await sleep(600);
await evaluate(`
  (() => {
    const nodes = [...document.querySelectorAll('*')].filter(
      (node) => node.children.length === 0 && node.textContent.trim() === '王明'
    );
    const target = nodes[nodes.length - 1]?.closest('[role="button"],button,a') ?? nodes[nodes.length - 1];
    if (target) target.click();
    return Boolean(target);
  })()
`);
await sleep(500);
await evaluate(`
  (() => {
    const nodes = [...document.querySelectorAll('*')].filter(
      (node) => node.children.length === 0 && node.textContent.trim() === '保存'
    );
    const target = nodes[nodes.length - 1]?.closest('[role="button"],button,a') ?? nodes[nodes.length - 1];
    if (target) target.click();
    return Boolean(target);
  })()
`);
await waitForText("川香居");
await evaluate(`
  (() => {
    const nodes = [...document.querySelectorAll('*')].filter(
      (node) => node.children.length === 0 && node.textContent.trim() === '川香居'
    );
    const target = nodes[nodes.length - 1]?.closest('[role="button"],button,a') ?? nodes[nodes.length - 1];
    if (target) target.click();
    return Boolean(target);
  })()
`);
await waitForText("暂无照片");

await evaluate(`
  (() => {
    const nodes = [...document.querySelectorAll('*')].filter(
      (node) => node.children.length === 0 && node.textContent.trim() === '添加真实菜品'
    );
    const target = nodes[nodes.length - 1]?.closest('[role="button"],button,a') ?? nodes[nodes.length - 1];
    if (target) target.click();
    return Boolean(target);
  })()
`);
await sleep(500);
await evaluate(`
  (() => {
    const setValue = (selector, value) => {
      const el = document.querySelector(selector);
      if (!el) return false;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    };
    setValue('input[placeholder="菜名"]', '烤鱼');
    setValue('input[placeholder="价格（元，可选）"]', '168');
    return true;
  })()
`);
await evaluate(`
  (() => {
    const nodes = [...document.querySelectorAll('*')].filter(
      (node) => node.children.length === 0 && node.textContent.trim() === '保存'
    );
    const target = nodes[nodes.length - 1]?.closest('[role="button"],button,a') ?? nodes[nodes.length - 1];
    if (target) target.click();
    return Boolean(target);
  })()
`);
await waitForText("烤鱼");
await evaluate(`
  (() => {
    const nodes = [...document.querySelectorAll('*')].filter(
      (node) => node.children.length === 0 && node.textContent.trim() === '好吃'
    );
    const target = nodes[nodes.length - 1]?.closest('[role="button"],button,a') ?? nodes[nodes.length - 1];
    if (target) target.click();
    return Boolean(target);
  })()
`);

await evaluate(`
  (() => {
    const nodes = [...document.querySelectorAll('*')].filter(
      (node) => node.children.length === 0 && node.textContent.trim() === '补充真实印象'
    );
    const target = nodes[nodes.length - 1]?.closest('[role="button"],button,a') ?? nodes[nodes.length - 1];
    if (target) target.click();
    return Boolean(target);
  })()
`);
await sleep(500);
await evaluate(`
  (() => {
    const el = document.querySelector('textarea[placeholder="例如 停车不方便，绕了两圈"]');
    if (!el) return false;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, '停车不方便');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()
`);
await evaluate(`
  (() => {
    const nodes = [...document.querySelectorAll('*')].filter(
      (node) => node.children.length === 0 && node.textContent.trim() === '保存'
    );
    const target = nodes[nodes.length - 1]?.closest('[role="button"],button,a') ?? nodes[nodes.length - 1];
    if (target) target.click();
    return Boolean(target);
  })()
`);
await waitForText("停车不方便");
await evaluate(`
  (() => {
    const nodes = [...document.querySelectorAll('*')].filter(
      (node) => node.children.length === 0 && node.textContent.trim() === '想去'
    );
    const target = nodes[nodes.length - 1]?.closest('[role="button"],button,a') ?? nodes[nodes.length - 1];
    if (target) target.click();
    return Boolean(target);
  })()
`);
await sleep(800);
const detailText = await evaluate("document.body.innerText");
if (!detailText.includes("烤鱼") || !detailText.includes("停车不方便") || !detailText.includes("想去")) {
  throw new Error(`detail did not include expected real data\n${detailText.slice(0, 1600)}`);
}

await evaluate(`
  (() => {
    const nodes = [...document.querySelectorAll('*')].filter(
      (node) => node.children.length === 0 && node.textContent.trim() === '下次聚餐'
    );
    const target = nodes[nodes.length - 1]?.closest('[role="button"],button,a') ?? nodes[nodes.length - 1];
    if (target) target.click();
    return Boolean(target);
  })()
`);
await waitForText("上次请客");
const prepText = await evaluate("document.body.innerText");
if (!prepText.includes("川香居") || !prepText.includes("停车不方便") || !prepText.includes("烤鱼")) {
  throw new Error(`next prep did not include expected real data\n${prepText.slice(0, 1600)}`);
}

console.log("PARTY_MEMORY_CARD_E2E_OK");
ws.close();
child.kill();
await sleep(500);
rmSync(userData, { recursive: true, force: true });
