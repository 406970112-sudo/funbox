import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const appUrl = "http://127.0.0.1:8081";
const port = 9800 + Math.floor(Math.random() * 100);
const userData = mkdtempSync(path.join(tmpdir(), "edge-size-library-e2e-"));

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

async function waitForText(text, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const body = await evalValue("document.body.innerText");
    if (body && body.includes(text)) return body;
    await sleep(500);
  }
  throw new Error(`等待文本超时: ${text}`);
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

console.log("导航到尺寸库工具页");
await send("Page.navigate", { url: `${appUrl}/tools/size-library` });
const emptyBody = await waitForText("还没有真实尺寸数据", 60000);
assertTrue(emptyBody.includes("我的尺寸库"), "尺寸库标题未显示");
assertTrue(emptyBody.includes("不预置示例数据") === false, "空态不应出现示例数据文案");

console.log("添加真实家人");
await clickText("添加家人");
await waitForText("添加家人", 15000);
await fillPlaceholder("请输入真实称呼", "妈妈");
await fillPlaceholder("请输入身高", "158");
await fillPlaceholder("请输入体重", "62");
await fillPlaceholder("请输入腰围", "78");
await fillPlaceholder("请输入鞋码", "37");
await fillPlaceholder("请输入衣服尺码", "L");
await fillPlaceholder("请输入戒指圈号", "12号");
await clickText("保存尺寸");
const savedBody = await waitForText("身体尺寸", 15000);
assertTrue(savedBody.includes("妈妈"), "保存后未显示妈妈档案");
assertTrue(savedBody.includes("158"), "保存后未显示真实身高");

console.log("进入妈妈档案详情并核对买衣服");
await clickText("买衣服核对");
const checkBody = await waitForText("买衣服 · 妈妈", 15000);
assertTrue(checkBody.includes("身高"), "核对卡未显示身高");
assertTrue(checkBody.includes("158"), "核对卡未显示真实身高值");
assertTrue(checkBody.includes("未填写"), "核对卡未显示缺失字段");
await clickText("复制真实尺寸");
await sleep(600);

console.log("返回主页并添加房间");
await clickText("主页");
await clickText("空间 0");
await clickText("添加");
await fillPlaceholder("请输入房间名称", "主卧");
await fillPlaceholder("请输入房间长", "360");
await fillPlaceholder("请输入房间宽", "320");
await fillPlaceholder("请输入房间高", "270");
await clickText("保存尺寸");
await waitForText("主卧", 15000);

console.log("重新打开尺寸库并添加窗帘");
await clickAriaLabel("返回");
await waitForText("主卧", 15000);
await clickText("空间 1");
await clickText("窗帘");
await clickText("添加");
await waitForText("添加窗帘", 15000);
await fillPlaceholder("请输入窗帘名称", "客厅窗帘");
await fillPlaceholder("请输入窗户宽", "240");
await fillPlaceholder("请输入窗户高", "260");
await fillPlaceholder("请输入窗帘宽", "250");
await fillPlaceholder("请输入窗帘高", "270");
await fillPlaceholder("请输入轨道长", "245");
await fillPlaceholder("请输入落地高度", "265");
await clickText("保存尺寸");
await waitForText("客厅窗帘", 15000);

console.log("验证首页搜索命中尺寸库");
await send("Page.navigate", { url: appUrl });
const homeBody = await waitForText("尺寸库", 60000);
assertTrue(homeBody.includes("我的尺寸库"), "首页未展示我的尺寸库工具");

console.log("E2E 通过");
ws.close();
child.kill();
await sleep(500);
rmSync(userData, { recursive: true, force: true });
