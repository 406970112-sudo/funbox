import test from "node:test";
import assert from "node:assert/strict";
import { createMemeFavoriteSync } from "../lib/meme-favorite-sync.ts";
import { parseMemeLocal } from "../lib/memes.ts";
function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function fixture(send) {
  let state = parseMemeLocal(null);
  state.favorites = ["x"];
  return {
    get state() {
      return state;
    },
    sync: createMemeFavoriteSync({
      read: () => state,
      write: (next) => {
        state = next;
      },
      send,
    }),
  };
}
test("slow A merge cannot clear guest or B records after account switch", async () => {
  const pending = deferred();
  const calls = [];
  const f = fixture(async (id, value, token) => {
    calls.push([id, value, token]);
    await pending.promise;
  });
  f.sync.setSession("A", "a");
  const work = f.sync.sync();
  await Promise.resolve();
  assert.deepEqual(f.state.favorites, []);
  assert.equal(f.state.favoriteQueues.A.x, true);
  f.sync.setSession(null, null);
  f.state.favorites.push("guest");
  f.sync.setSession("B", "b");
  pending.resolve();
  await work;
  assert.deepEqual(f.state.favorites, ["guest"]);
  assert.equal(f.state.favoriteQueues.A.x, true);
  assert.equal(f.state.favoriteQueues.B, undefined);
  assert.deepEqual(calls, [["x", true, "a"]]);
});
test("unfavorite waits behind an in-flight merge PUT and cannot be resurrected", async () => {
  const pending = deferred();
  const calls = [];
  const f = fixture(async (id, value) => {
    calls.push(value);
    if (value) await pending.promise;
  });
  f.sync.setSession("A", "a");
  const merge = f.sync.sync();
  await Promise.resolve();
  const remove = f.sync.setFavorite("x", false);
  await Promise.resolve();
  assert.deepEqual(calls, [true]);
  pending.resolve();
  await Promise.all([merge, remove]);
  assert.deepEqual(calls, [true, false]);
  assert.deepEqual(f.state.favoriteQueues.A, {});
});
test("token rotation retains same account acknowledgments and uses latest token for next item", async () => {
  const pending = deferred();
  const calls = [];
  const f = fixture(async (id, value, token) => {
    calls.push([id, token]);
    if (id === "x") await pending.promise;
  });
  f.state.favorites.push("y");
  f.sync.setSession("A", "old");
  const work = f.sync.sync();
  await Promise.resolve();
  f.sync.setSession("A", "new");
  pending.resolve();
  await work;
  assert.deepEqual(calls, [
    ["x", "old"],
    ["y", "new"],
  ]);
  assert.deepEqual(f.state.favoriteQueues.A, {});
});
test("failed account-bound pending survives persistence without leaking to another account", async () => {
  const f = fixture(async () => {
    throw Error("offline");
  });
  f.sync.setSession("A", "a");
  await f.sync.sync();
  const restored = parseMemeLocal(JSON.stringify(f.state));
  assert.equal(restored.favoriteQueues.A.x, true);
  assert.deepEqual(restored.favorites, []);
});

test("remount serializes a new removal behind the previous instance upload", async () => {
  const pending = deferred();
  const calls = [];
  let state = parseMemeLocal(null);
  state.favorites = ["x"];
  const dependencies = {
    read: () => state,
    write: (v) => {
      state = v;
    },
    send: async (id, value) => {
      calls.push(value);
      if (value) await pending.promise;
    },
  };
  const first = createMemeFavoriteSync(dependencies);
  first.setSession("remount", "a");
  const uploading = first.sync();
  await Promise.resolve();
  first.setSession(null, null);
  const second = createMemeFavoriteSync(dependencies);
  second.setSession("remount", "b");
  const removing = second.setFavorite("x", false);
  await Promise.resolve();
  assert.deepEqual(calls, [true]);
  pending.resolve();
  await Promise.all([uploading, removing]);
  assert.deepEqual(calls, [true, false]);
  assert.deepEqual(state.favoriteQueues.remount, {});
});

test("partial merge acknowledges successes and retains only failed account items", async () => {
  const f = fixture(async (id) => {
    if (id === "y") throw Error("offline");
  });
  f.state.favorites.push("y");
  f.sync.setSession("partial", "a");
  await f.sync.sync();
  assert.deepEqual(f.state.favoriteQueues.partial, { y: true });
});
