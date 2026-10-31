import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMemeQuery,
  parseMemeLocal,
  addRecentMeme,
  createMemeRequestGate,
  performMemeSave,
} from "../lib/memes.ts";

test("query preserves false animation filter, escapes search and fixes page size", () => {
  assert.equal(
    buildMemeQuery({
      q: " 猫 & 狗 ",
      animated: false,
      category: "a/b",
      cursor: "x+y",
    }),
    "?q=%E7%8C%AB+%26+%E7%8B%97&category=a%2Fb&animated=false&cursor=x%2By&limit=36",
  );
});
test("corrupt storage cannot break browsing; valid favorites deduplicate", () => {
  assert.deepEqual(parseMemeLocal("{oops").favorites, []);
  assert.deepEqual(
    parseMemeLocal('{"version":1,"favorites":["a","a",2],"recent":[]}')
      .favorites,
    ["a"],
  );
  assert.deepEqual(
    parseMemeLocal('{"version":2,"favorites":["a"]}').favorites,
    [],
  );
});
test("recent browsing deduplicates and bounds persisted history", () => {
  let ids = ["b", "a"];
  ids = addRecentMeme(ids, "a");
  assert.deepEqual(ids, ["a", "b"]);
  for (let i = 0; i < 120; i++) ids = addRecentMeme(ids, String(i));
  assert.equal(ids.length, 60);
});
test("old search response and its error cannot overwrite newer request", () => {
  const gate = createMemeRequestGate();
  const a = gate.start();
  const b = gate.start();
  assert.equal(gate.current(a), false);
  assert.equal(gate.current(b), true);
  gate.cancel();
  assert.equal(gate.current(b), false);
});
test("save event only emitted on a verified completion, never cancel or download-start", async () => {
  let events = 0;
  for (const outcome of ["cancelled", "started"])
    await performMemeSave(
      async () => outcome,
      async () => {
        events++;
      },
    );
  assert.equal(events, 0);
  await assert.rejects(
    performMemeSave(
      async () => {
        throw Error("network");
      },
      async () => {
        events++;
      },
    ),
    /network/,
  );
  assert.equal(events, 0);
  await performMemeSave(
    async () => "saved",
    async () => {
      events++;
    },
  );
  assert.equal(events, 1);
});

test("API sends authorization and preserves backend status errors without claiming success", async () => {
  const { createServer } = await import("node:http");
  const { memeRequest, MemeAPIError } = await import("../lib/memes-api.ts");
  const server = createServer((req, res) => {
    if (req.headers.authorization !== "Bearer actual-token") {
      res.writeHead(401);
      res.end('{"error":"unauthorized"}');
      return;
    }
    if (req.url.includes("stale")) {
      res.writeHead(409);
      res.end('{"error":"snapshot_changed","detail":"图库已更新"}');
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ favorite: true }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.deepEqual(
      await memeRequest("/a/favorite", "actual-token", { method: "PUT" }, base),
      { favorite: true },
    );
    await assert.rejects(
      memeRequest("/stale", "actual-token", {}, base),
      (error) =>
        error instanceof MemeAPIError &&
        error.status === 409 &&
        error.message === "图库已更新",
    );
    await assert.rejects(
      memeRequest("/favorites", null, {}, base),
      (error) => error.status === 401,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
