import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const backend = "http://127.0.0.1:3000";
const appUrl = "http://127.0.0.1:8081";
const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const port = 9800 + Math.floor(Math.random() * 300);
const userData = mkdtempSync(path.join(tmpdir(), "edge-who-does-it-e2e-"));

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

async function waitForText(text, timeoutMs = 120000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const body = await evaluate("document.body?.innerText ?? ''");
    if (body.includes(text)) return body;
    await sleep(1000);
  }
  throw new Error(`text not found: ${text}`);
}

async function waitForExpression(expression, timeoutMs = 120000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await evaluate(expression)) return;
    await sleep(800);
  }
  throw new Error(`expression not true: ${expression}`);
}

async function clickByText(text) {
  const clicked = await evaluate(`(() => {
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const nodes = [...document.querySelectorAll('div, span')]
      .filter((node) => node.textContent && node.textContent.trim() === ${JSON.stringify(text)})
      .sort((left, right) => left.children.length - right.children.length);
    const visible = nodes.find(isVisible) ?? nodes[0];
    const target = visible?.closest('button, [role="button"]') ?? visible;
    if (target) target.click();
    return Boolean(target);
  })()`);
  if (!clicked) throw new Error(`button not found: ${text}`);
  await sleep(500);
}

async function setInput(placeholder, value) {
  const ok = await evaluate(`(() => {
    const input = [...document.querySelectorAll('input')]
      .find((item) => item.placeholder === ${JSON.stringify(placeholder)});
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  if (!ok) {
    const inputs = await evaluate(`JSON.stringify([...document.querySelectorAll('input')].map((input) => input.placeholder))`);
    throw new Error(`input not found: ${placeholder} inputs=${inputs}`);
  }
  await sleep(300);
}

async function bodyText() {
  return evaluate("document.body?.innerText ?? ''");
}

let failure;
try {
  const username = `139${String(Date.now()).slice(-8)}`;
  const registerResponse = await fetch(`${backend}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username,
      password: "password-123",
      displayName: "转盘测试",
      securityQuestion: "你的第一个绰号是什么？",
      securityAnswer: "小转",
    }),
  });
  const session = await registerResponse.json();
  if (!session.accessToken) throw new Error(`register failed: ${JSON.stringify(session)}`);
  const token = session.accessToken;

  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 430,
    height: 900,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await send("Page.navigate", { url: `${appUrl}/tools/who-does-it` });
  await waitForText("谁来干");
  await evaluate(`localStorage.setItem('funbox.auth.access-token.v1', ${JSON.stringify(token)})`);
  await send("Page.reload", { ignoreCache: true });
  await waitForText("谁来干", 180000);
  await waitForText("真实名单", 30000);

  await clickByText("人员 0");
  await setInput("输入真实姓名，可批量粘贴", "阿伟,小红,小蓝,小北");
  await clickByText("添加");
  await waitForText("阿伟");
  await waitForText("小北");
  const peopleBody = await bodyText();
  if ((peopleBody.match(/真实姓名/g) || []).length < 4) {
    throw new Error("people were not added");
  }
  console.log("PEOPLE_OK");

  await clickByText("转盘");
  await clickByText("自定义");
  await setInput("例如：去洗碗、大冒险、喝一杯", "去洗碗");
  await clickByText("开始抽");
  await sleep(4500);
  await waitForText("本次结果");
  const resultBody = await bodyText();
  if (!resultBody.includes("去洗碗")) throw new Error("task missing from result");
  const resultLines = resultBody
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const resultIndex = resultLines.indexOf("本次结果");
  const winner = resultLines[resultIndex + 2];
  if (!winner || !resultBody.includes("去洗碗")) {
    throw new Error(`winner missing: ${resultBody.slice(0, 500)}`);
  }
  const wheelDebug = await evaluate(`JSON.stringify({
    wheelTransform: [...document.querySelectorAll('div')]
      .filter((div) => div.firstElementChild?.tagName === 'svg' && div.style.transform)
      .map((div) => ({ width: div.style.width, height: div.style.height, transform: div.style.transform })),
    allTransforms: [...document.querySelectorAll('div')]
      .filter((div) => div.style.transform)
      .map((div) => ({ width: div.style.width, height: div.style.height, transform: div.style.transform }))
  })`);
  const debug = JSON.parse(wheelDebug);
  const transforms = debug.wheelTransform.length > 0 ? debug.wheelTransform : debug.allTransforms;
  const wheelEntry = transforms.find(
    (entry) => entry.width === "292px" || entry.transform.includes("deg"),
  );
  const rotateValue = wheelEntry
    ? Number(wheelEntry.transform.match(/rotate\((-?[\d.]+)deg\)/)?.[1])
    : NaN;
  if (!Number.isFinite(rotateValue)) {
    throw new Error(`wheel transform missing: ${JSON.stringify(debug)}`);
  }
  const participants = ["阿伟", "小红", "小蓝", "小北"];
  const winnerIndex = participants.indexOf(winner);
  const expectedAngle = (360 - ((winnerIndex + 0.5) * 360) / participants.length) % 360;
  const actualAngle = ((rotateValue % 360) + 360) % 360;
  if (Math.abs(actualAngle - expectedAngle) > 5 && Math.abs(actualAngle - expectedAngle - 360) > 5) {
    throw new Error(
      `wheel not aligned: actual=${actualAngle} expected=${expectedAngle} transform=${rotateValue}`,
    );
  }
  console.log("WHEEL_ALIGN_OK", actualAngle, expectedAngle);
  console.log("SPIN_OK", winner);

  await clickByText("完成");
  await clickByText("历史 1");
  await waitForText("今日真实抽签");
  await waitForText("去洗碗");
  const historyBody = await bodyText();
  if (!historyBody.includes(winner)) throw new Error("winner missing from history");
  console.log("HISTORY_OK");

  const recordsPayload = await (
    await fetch(`${backend}/api/v1/who-does-it/records`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json();
  const records = recordsPayload.records ?? [];
  if (records.length !== 1 || records[0].taskText !== "去洗碗" || records[0].winnerName !== winner) {
    throw new Error(`API record mismatch: ${JSON.stringify(recordsPayload)}`);
  }
  console.log("SYNC_OK", JSON.stringify(records[0]));

  await send("Page.navigate", { url: appUrl });
  await waitForExpression(
    `Boolean([...document.querySelectorAll('input')].find((input) => input.placeholder === '搜索工具、游戏或场景'))`,
  );
  await setInput("搜索工具、游戏或场景", "大转盘");
  await waitForText("谁来干");
  const searchBody = await bodyText();
  if (!searchBody.includes("大转盘随机抽人")) throw new Error("search tagline missing");
  console.log("SEARCH_OK");

  const shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(
    path.join("C:/Users/Administrator/Documents/funbox/docs", "who-does-it-e2e-search.png"),
    Buffer.from(shot.data, "base64"),
  );
} catch (error) {
  failure = error;
  console.error("E2E_FAILED", error);
} finally {
  try { ws.close(); } catch {}
  child.kill();
  await sleep(500);
  rmSync(userData, { recursive: true, force: true });
}

if (failure) process.exit(1);
