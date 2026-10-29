const test = require("node:test");
const assert = require("node:assert/strict");

const scoreAPI = require.resolve("../utils/score-api");
const config = require.resolve("../config/index");
const realtimeModule = require.resolve("../utils/score-realtime");

function loadRealtime(ticketValue) {
  delete require.cache[realtimeModule];
  require.cache[scoreAPI] = {
    id: scoreAPI,
    filename: scoreAPI,
    loaded: true,
    exports: { createRealtimeTicket: async () => ticketValue },
  };
  require.cache[config] = {
    id: config,
    filename: config,
    loaded: true,
    exports: { API_BASE_URL: "https://example.test/api/v1" },
  };
  return require(realtimeModule);
}

function createSocketTask() {
  const callbacks = {};
  return {
    callbacks,
    closed: false,
    closeCalls: 0,
    close() {
      this.closed = true;
      this.closeCalls += 1;
      if (callbacks.close) callbacks.close({ code: 1000 });
    },
    onOpen(callback) {
      callbacks.open = callback;
    },
    onMessage(callback) {
      callbacks.message = callback;
    },
    onError(callback) {
      callbacks.error = callback;
    },
    onClose(callback) {
      callbacks.close = callback;
    },
  };
}

async function flushPromises() {
  await new Promise((resolve) => setImmediate(resolve));
}

function createConnection(t) {
  const timers = new Map();
  const tasks = [];
  const statuses = [];
  const failures = [];
  const invalidations = [];
  let nextTimer = 0;
  let networkListener;
  t.mock.method(global, "setTimeout", (callback, delay) => {
    timers.set(++nextTimer, { callback, delay });
    return nextTimer;
  });
  t.mock.method(global, "clearTimeout", (id) => timers.delete(id));
  global.wx = {
    connectSocket(options) {
      const task = createSocketTask();
      task.options = options;
      tasks.push(task);
      return task;
    },
    onNetworkStatusChange(callback) { networkListener = callback; },
    offNetworkStatusChange(callback) {
      if (networkListener === callback) networkListener = null;
    },
  };
  const { connectScoreRealtime } = loadRealtime("ticket-1");
  const close = connectScoreRealtime({
    credential: { kind: "account", token: "host-token" },
    roomId: "room-1",
    onStatus: (status, reason) => {
      statuses.push(status);
      if (reason) failures.push(reason);
    },
    onInvalidate: (version) => invalidations.push(version),
  });
  t.after(close);
  return { timers, tasks, statuses, failures, invalidations, close,
    network: (isConnected) => {
      if (networkListener) networkListener({ isConnected });
    },
    hasNetworkListener: () => Boolean(networkListener),
  };
}

test("native socket handshakes use the API origin accepted by the server", async (t) => {
  const connection = createConnection(t);
  await flushPromises();
  assert.equal(connection.tasks[0].options.header?.Origin, "https://example.test");
  connection.tasks[0].callbacks.open();
  assert.equal(connection.statuses.at(-1), "online");
});

test("handshake failures report an actionable reason without exposing the ticket", async (t) => {
  const connection = createConnection(t);
  await flushPromises();
  connection.tasks[0].callbacks.error({ errMsg: "Unexpected response code: 403 wss://example.test/api/v1/realtime/ws?ticket=secret" });
  assert.equal(connection.failures.length, 1);
  assert.equal(connection.failures[0], "forbidden");
  assert.doesNotMatch(connection.failures[0], /secret|ticket=/);
});

for (const [error, reason] of [
  [{ errMsg: "connectSocket:fail url not in domain list" }, "domain"],
  [{ statusCode: 401, message: "unauthorized" }, "unauthorized"],
  [{ errMsg: "connectSocket:fail SSL handshake failed" }, "tls"],
  [{ errMsg: "connectSocket:fail timeout" }, "timeout"],
  [{ errMsg: "connectSocket:fail connection reset" }, "network"],
]) {
  test(`connection failure reports ${reason} recovery guidance`, async (t) => {
    const connection = createConnection(t);
    await flushPromises();
    connection.tasks[0].options.fail(error);
    assert.deepEqual(connection.failures, [reason]);
    assert.equal(connection.statuses.at(-1), "offline");
  });
}

test("network recovery replaces a stale socket and ignores its late callbacks", async (t) => {
  const connection = createConnection(t);
  await flushPromises();
  connection.tasks[0].callbacks.open();

  connection.network(false);
  assert.equal(connection.statuses.at(-1), "offline");
  assert.equal(connection.tasks[0].closed, true);
  assert.equal(connection.timers.size, 0);

  connection.network(true);
  await flushPromises();
  assert.equal(connection.tasks.length, 2);
  connection.tasks[1].callbacks.open();
  connection.tasks[0].callbacks.error();
  connection.tasks[0].callbacks.close();
  assert.equal(connection.statuses.at(-1), "online");
  assert.equal(connection.timers.size, 0);

  connection.close();
  assert.equal(connection.hasNetworkListener(), false);
  connection.network(true);
  await flushPromises();
  assert.equal(connection.tasks.length, 2);
});

test("a socket handshake that never completes times out and retries", async (t) => {
  const connection = createConnection(t);
  await flushPromises();
  assert.equal(connection.timers.size, 1);
  const [timerId, timeout] = [...connection.timers.entries()][0];
  assert.equal(timeout.delay, 10000);
  connection.timers.delete(timerId);
  timeout.callback();
  assert.equal(connection.tasks[0].closed, true);
  assert.equal(connection.statuses.at(-1), "offline");
  assert.equal(connection.timers.size, 1);
  const [retryId, retry] = [...connection.timers.entries()][0];
  assert.equal(retry.delay, 1000);
  connection.timers.delete(retryId);
  retry.callback();
  await flushPromises();
  connection.tasks[1].callbacks.open();
  assert.equal(connection.statuses.at(-1), "online");
  assert.equal(connection.timers.size, 0);
});

test("connection creation failures retry once and cannot be revived by a late open", async (t) => {
  const connection = createConnection(t);
  await flushPromises();
  const task = connection.tasks[0];
  assert.equal(typeof task.options.fail, "function");
  task.options.fail({ errMsg: "connectSocket:fail network is down" });
  task.callbacks.error();
  task.callbacks.open();
  task.callbacks.message({ data: JSON.stringify({ type: "score.room.updated", data: { roomId: "room-1", roomVersion: 5 } }) });
  assert.deepEqual(connection.statuses, ["connecting", "offline"]);
  assert.deepEqual(connection.invalidations, []);
  assert.equal(connection.timers.size, 1);
  assert.equal(task.closeCalls, 2);
});

test("socket errors schedule one reconnect and still forward room events", async (t) => {
  const connection = createConnection(t);
  await flushPromises();
  const task = connection.tasks[0];
  task.callbacks.open();
  task.callbacks.message({ data: JSON.stringify({ type: "score.room.updated", data: { roomId: "room-1", roomVersion: 4, sequence: 9 } }) });
  task.callbacks.error();
  task.callbacks.close();

  assert.deepEqual(connection.invalidations, [4]);
  assert.deepEqual(connection.statuses, ["connecting", "online", "offline"]);
  assert.equal(connection.timers.size, 1);
  assert.equal([...connection.timers.values()][0].delay, 1000);
});
