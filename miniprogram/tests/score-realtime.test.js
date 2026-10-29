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
    close() {
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

test("socket errors schedule one reconnect and still forward room events", async () => {
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const timers = [];
  const tasks = [];
  const statuses = [];
  const invalidations = [];

  global.setTimeout = (callback, delay) => {
    timers.push({ callback, delay });
    return timers.length;
  };
  global.clearTimeout = () => undefined;
  global.wx = {
    connectSocket() {
      const task = createSocketTask();
      tasks.push(task);
      return task;
    },
  };

  try {
    const { connectScoreRealtime } = loadRealtime("ticket-1");
    const close = connectScoreRealtime({
      credential: { token: "guest-token" },
      roomId: "room-1",
      onInvalidate: (version, sequence) => invalidations.push([version, sequence]),
      onStatus: (status) => statuses.push(status),
    });
    await flushPromises();

    assert.equal(tasks.length, 1);
    tasks[0].callbacks.open();
    tasks[0].callbacks.message({ data: JSON.stringify({ type: "score.room.updated", data: { roomId: "room-1", roomVersion: 4, sequence: 9 } }) });
    tasks[0].callbacks.error();
    assert.equal(timers.length, 1);
    tasks[0].callbacks.close();

    assert.deepEqual(invalidations, [[4, 9]]);
    assert.deepEqual(statuses, ["connecting", "online", "offline"]);
    assert.equal(timers.length, 1);
    assert.equal(timers[0].delay, 1000);

    close();
  } finally {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});
