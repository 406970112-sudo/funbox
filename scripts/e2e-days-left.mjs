import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const backend = "http://127.0.0.1:3001";
const appUrl = "http://127.0.0.1:8081/tools/days-left";
const outDir = "C:/Users/Administrator/Documents/funbox/docs";
const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const port = 9600 + Math.floor(Math.random() * 300);
const userData = mkdtempSync(path.join(tmpdir(), "edge-e2e-"));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForTarget() {
  for (let i = 0; i < 90; i++) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = pages.find((p) => p.type === "page");
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(200);
  }
  throw new Error("Edge DevTools endpoint did not start");
}

const child = spawn(
  edgePath,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userData}`,
    "about:blank",
  ],
  { stdio: "ignore" }
);

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
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || "evaluate failed");
  }
  return result.result.value;
}

async function waitForText(text, timeoutMs = 90000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const body = await evaluate("document.body?.innerText ?? ''");
    if (body.includes(text)) return body;
    await sleep(1000);
  }
  throw new Error(`text not found: ${text}`);
}

const username = `138${String(Date.now()).slice(-8)}`;
const registerResponse = await fetch(`${backend}/api/v1/auth/register`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    username,
    password: "password-123",
    displayName: "期限测试",
    securityQuestion: "你的第一个绰号是什么？",
    securityAnswer: "小限",
  }),
});
const session = await registerResponse.json();
if (!session.accessToken) {
  throw new Error(`register failed: ${JSON.stringify(session)}`);
}
const token = session.accessToken;

const categoriesPayload = await (
  await fetch(`${backend}/api/v1/days-left/categories`, {
    headers: { Authorization: `Bearer ${token}` },
  })
).json();
const digital = categoriesPayload.categories.find((category) => category.name === "数字资产");
if (!digital) {
  throw new Error("digital asset category missing");
}
const expiry = new Date();
expiry.setDate(expiry.getDate() + 83);
const expiryDate = expiry.toISOString().slice(0, 10);
const createResponse = await fetch(`${backend}/api/v1/days-left/records`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    categoryId: digital.id,
    name: "xwhub.cn SSL 证书",
    recordType: "recurring",
    expiryDate,
    cycleUnit: "year",
    cycleInterval: 1,
    reminderLeadDays: 30,
    source: "api",
    verified: true,
  }),
});
if (!createResponse.ok) {
  throw new Error(`create record failed: ${createResponse.status} ${await createResponse.text()}`);
}

await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: 430,
  height: 900,
  deviceScaleFactor: 1,
  mobile: true,
});
await send("Page.navigate", { url: appUrl });
await waitForText("还有几天", 120000);
await evaluate(`localStorage.setItem('funbox.auth.access-token.v1', ${JSON.stringify(token)})`);
await send("Page.reload", { ignoreCache: true });
const body = await waitForText("xwhub.cn SSL 证书", 120000);
console.log("HOME_OK", body.slice(0, 600).replace(/\n+/g, " | "));

const homeShot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(path.join(outDir, "days-left-e2e-home.png"), Buffer.from(homeShot.data, "base64"));

try {
  await evaluate(`(() => {
    const buttons = [...document.querySelectorAll('button, [role="button"]')];
    const add = buttons.find((button) => button.textContent.includes('添加到期记录') || button.textContent.includes('添加'));
    if (add) add.click();
    return Boolean(add);
  })()`);
  await sleep(1500);
  console.log("MODAL", await evaluate(`JSON.stringify({
    text: document.body.innerText.slice(0, 500),
    inputs: [...document.querySelectorAll('input')].map((input) => input.placeholder || input.getAttribute('aria-label') || input.type),
    buttons: [...document.querySelectorAll('button, [role="button"]')].map((button) => button.textContent.trim())
  })`));
  const filled = await evaluate(`(() => {
    const setValue = (input, value) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const name = document.querySelector('input[placeholder="例如：身份证、房租、药品"]');
    if (name) setValue(name, '测试续费记录 2027');
    const date = document.querySelector('input[placeholder="YYYY-MM-DD"]');
    const nextYear = new Date();
    nextYear.setFullYear(nextYear.getFullYear() + 1);
    if (date) setValue(date, nextYear.toISOString().slice(0, 10));
    return { name: Boolean(name), date: Boolean(date), nameValue: name?.value, dateValue: date?.value };
  })()`);
  console.log("FILLED", JSON.stringify(filled));
  await sleep(300);
  console.log("BUTTONS_AFTER", await evaluate(`JSON.stringify([...document.querySelectorAll('button, [role="button"]')].map((button) => button.textContent.trim()))`));
  console.log("SAVE_NODES", await evaluate(`JSON.stringify([...document.querySelectorAll('*')]
    .filter((el) => el.textContent && el.textContent.includes('保存记录') && el.children.length < 6)
    .map((el) => ({ tag: el.tagName, cls: String(el.className || '').slice(0, 80), html: el.outerHTML.slice(0, 180) }))
    .slice(0, 10))`));
  const saveClicked = await evaluate(`(() => {
    const nodes = [...document.querySelectorAll('div, span')];
    const textNode = nodes.find((node) => node.textContent && node.textContent.trim() === '保存记录');
    let target = textNode;
    while (target && !target.hasAttribute('tabindex')) target = target.parentElement;
    if (target) target.click();
    return Boolean(target);
  })()`);
  console.log("SAVE_CLICKED", saveClicked);
  await sleep(1800);
  console.log("AFTER_SAVE", await evaluate(`document.body.innerText.slice(-700).replace(/\\n+/g, ' | ')`));
  const apiRecords = await (
    await fetch(`${backend}/api/v1/days-left/records`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json();
  console.log("API_RECORDS", JSON.stringify(apiRecords.records?.map((record) => record.name) ?? apiRecords));
  const createdNames = (apiRecords.records ?? []).map((record) => record.name);
  if (!createdNames.includes("测试续费记录 2027")) {
    throw new Error("UI-created record missing from API");
  }
  console.log("ADD_OK");
} finally {
  try { ws.close(); } catch {}
  child.kill();
  await sleep(500);
  rmSync(userData, { recursive: true, force: true });
}
