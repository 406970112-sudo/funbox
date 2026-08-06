import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "frontend", "dist-go-out");
const port = Number(process.env.PORT || 8084);

createServer(async (request, response) => {
  const url = new URL(request.url || "/", "http://127.0.0.1");
  let filePath = path.join(root, decodeURIComponent(url.pathname));
  if (!filePath.startsWith(root)) filePath = path.join(root, "index.html");
  try {
    const data = await readFile(filePath);
    const contentType =
      filePath.endsWith(".html") ? "text/html; charset=utf-8"
      : filePath.endsWith(".js") ? "text/javascript; charset=utf-8"
      : filePath.endsWith(".json") ? "application/json; charset=utf-8"
      : filePath.endsWith(".ico") ? "image/x-icon"
      : filePath.endsWith(".ttf") ? "font/ttf"
      : "application/octet-stream";
    response.writeHead(200, { "Content-Type": contentType });
    response.end(data);
  } catch {
    try {
      const data = await readFile(path.join(root, "index.html"));
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(data);
    } catch {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
    }
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`spa server listening on http://127.0.0.1:${port}`);
});
