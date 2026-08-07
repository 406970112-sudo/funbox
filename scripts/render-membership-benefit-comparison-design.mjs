import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const boardFile = path.join(repoRoot, "docs", "membership-benefit-comparison-design-v1.html");
const outputFile = path.join(repoRoot, "docs", "membership-benefit-comparison-design-v1.png");
const port = 9300 + Math.floor(Math.random() * 500);
const userData = mkdtempSync(path.join(tmpdir(), "edge-membership-design-"));
const child = spawn(edgePath, [
  "--headless=new",
  "--disable-gpu",
  "--hide-scrollbars",
  "--no-first-run",
  "--no-default-browser-check",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${userData}`,
  "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} -> ${response.status}`);
  return response.json();
}
async function waitForTarget() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const pages = await getJson(`http://127.0.0.1:${port}/json/list`);
      const page = pages.find((entry) => entry.type === "page");
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      // Edge is still starting.
    }
    await sleep(200);
  }
  throw new Error("Edge DevTools endpoint did not start");
}

const ws = new WebSocket(await waitForTarget());
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});
let nextId = 1;
const pending = new Map();
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(JSON.stringify(message.error)));
  else resolve(message.result);
};
function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: 1600,
  height: 1500,
  deviceScaleFactor: 1,
  mobile: false,
});
await send("Page.navigate", { url: pathToFileURL(boardFile).href });
await sleep(900);
const screenshot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
writeFileSync(outputFile, Buffer.from(screenshot.data, "base64"));
const state = await send("Runtime.evaluate", {
  expression: `(() => ({
    title: document.title,
    compareTables: document.querySelectorAll('.compare').length,
    extraRows: document.querySelectorAll('.extra').length,
    expandedTables: document.querySelectorAll('.compare.is-expanded').length,
    overflow: document.documentElement.scrollWidth > innerWidth,
  }))()`,
  returnByValue: true,
});
console.log(JSON.stringify(state.result.value));
ws.close();
child.kill();
await sleep(300);
rmSync(userData, { recursive: true, force: true });
