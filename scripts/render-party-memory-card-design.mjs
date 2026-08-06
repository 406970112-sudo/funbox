import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const boardFile = "C:/Users/Administrator/Documents/funbox/docs/party-memory-card-product-design-v1.html";
const outDir = "C:/Users/Administrator/Documents/funbox/docs";
const boardUrl = `file:///${boardFile.replace(/\\/g, "/")}`;
const port = 9800 + Math.floor(Math.random() * 500);
const userData = mkdtempSync(path.join(tmpdir(), "edge-party-memory-card-"));

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

await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: 1760,
  height: 2600,
  deviceScaleFactor: 1,
  mobile: false,
});
await send("Page.navigate", { url: boardUrl });
await sleep(8000);

const layout = await send("Runtime.evaluate", {
  expression: `(() => {
    const wraps = [...document.querySelectorAll('.phone-wrap')];
    const phones = wraps.map((wrap, index) => {
      const screen = wrap.querySelector('.phone-screen');
      const content = wrap.querySelector('.screen-content');
      const rect = wrap.getBoundingClientRect();
      const overflow = [];
      content.querySelectorAll('*').forEach((el) => {
        const r = el.getBoundingClientRect();
        const cr = content.getBoundingClientRect();
        if (r.right > cr.right + 1 || r.left < cr.left - 1 || r.bottom > cr.bottom + 1 || r.top < cr.top - 1) {
          overflow.push({ tag: el.tagName, cls: el.className, text: (el.textContent || '').trim().slice(0, 24) });
        }
      });
      return {
        index,
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        contentOverflow: content.scrollHeight > content.clientHeight + 2,
        contentScrollHeight: content.scrollHeight,
        contentClientHeight: content.clientHeight,
        overflowCount: overflow.length,
        overflow
      };
    });
    const doc = document.documentElement;
    return {
      viewport: { width: innerWidth, height: innerHeight },
      doc: { scrollWidth: doc.scrollWidth, scrollHeight: doc.scrollHeight },
      iconCount: document.querySelectorAll('i[data-lucide]').length,
      svgCount: document.querySelectorAll('svg.lucide').length,
      phones
    };
  })()`,
  returnByValue: true,
});

console.log(JSON.stringify(layout.result.value, null, 2));

const full = await send("Page.captureScreenshot", {
  format: "png",
  captureBeyondViewport: true,
});
writeFileSync(path.join(outDir, "party-memory-card-product-design-v1.png"), Buffer.from(full.data, "base64"));

const labels = [
  "home-empty",
  "record-basics",
  "record-content",
  "detail",
  "next-prep",
  "collaboration",
  "search-list",
  "declaration",
];
for (const phone of layout.result.value.phones) {
  const shot = await send("Page.captureScreenshot", {
    format: "png",
    clip: {
      x: phone.x,
      y: phone.y,
      width: phone.width,
      height: phone.height,
      scale: 1,
    },
  });
  writeFileSync(
    path.join(outDir, `party-memory-card-product-design-v1-${labels[phone.index]}-mobile.png`),
    Buffer.from(shot.data, "base64")
  );
}

ws.close();
child.kill();
await sleep(500);
rmSync(userData, { recursive: true, force: true });
