const { API_BASE_URL } = require("../config/index");
const { createRealtimeTicket } = require("./score-api");

function realtimeURL(ticket) {
  const base = API_BASE_URL.replace(/^https:/i, "wss:").replace(/^http:/i, "ws:");
  return `${base}/realtime/ws?ticket=${encodeURIComponent(ticket)}`;
}

function connectScoreRealtime({ credential, roomId, onInvalidate, onStatus }) {
  let disposed = false;
  let socketTask = null;
  let retryTimer = null;
  let retryCount = 0;
  let generation = 0;

  async function connect() {
    if (disposed) return;
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    const currentGeneration = ++generation;
    onStatus("connecting");
    try {
      const ticket = await createRealtimeTicket(credential, roomId);
      if (disposed || currentGeneration !== generation) return;
      const task = wx.connectSocket({ url: realtimeURL(ticket) });
      socketTask = task;
      let finished = false;

      const handleDisconnect = () => {
        if (finished || disposed || currentGeneration !== generation) return;
        finished = true;
        if (socketTask === task) socketTask = null;
        onStatus("offline");
        scheduleReconnect();
      };

      task.onOpen(() => {
        if (disposed || currentGeneration !== generation) return;
        retryCount = 0;
        onStatus("online");
      });
      task.onMessage((message) => {
        if (disposed || currentGeneration !== generation) return;
        try {
          const event = JSON.parse(String(message.data));
          if (event.type === "score.room.updated" && event.data && event.data.roomId === roomId) {
            onInvalidate(event.data.roomVersion || 0, event.data.sequence || 0);
          }
        } catch (error) {
          // REST snapshots remain authoritative when an event cannot be decoded.
        }
      });
      task.onError(() => {
        handleDisconnect();
        try {
          task.close({ code: 4000, reason: "socket error" });
        } catch (error) {
          // The reconnect timer is already scheduled; closing is best effort.
        }
      });
      task.onClose(handleDisconnect);
    } catch (error) {
      if (disposed || currentGeneration !== generation) return;
      onStatus("offline");
      scheduleReconnect();
    }
  }

  function scheduleReconnect() {
    if (disposed || retryTimer) return;
    const delay = Math.min(1000 * Math.pow(2, retryCount), 15000);
    retryCount += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      connect();
    }, delay);
  }

  connect();

  return function close() {
    disposed = true;
    generation += 1;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    const task = socketTask;
    socketTask = null;
    if (task) {
      try {
        task.close({ code: 1000, reason: "page closed" });
      } catch (error) {
        // The page is leaving; a stale socket no longer needs cleanup.
      }
    }
  };
}

module.exports = {
  connectScoreRealtime,
};
