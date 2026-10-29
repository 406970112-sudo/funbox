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

  async function connect() {
    if (disposed) return;
    onStatus("connecting");
    try {
      const ticket = await createRealtimeTicket(credential, roomId);
      if (disposed) return;
      socketTask = wx.connectSocket({ url: realtimeURL(ticket) });
      socketTask.onOpen(() => {
        retryCount = 0;
        onStatus("online");
      });
      socketTask.onMessage((message) => {
        try {
          const event = JSON.parse(String(message.data));
          if (event.type === "score.room.updated" && event.data && event.data.roomId === roomId) {
            onInvalidate(event.data.roomVersion || 0, event.data.sequence || 0);
          }
        } catch (error) {
          // REST snapshots remain authoritative when an event cannot be decoded.
        }
      });
      socketTask.onError(() => onStatus("offline"));
      socketTask.onClose(() => {
        socketTask = null;
        if (disposed) return;
        onStatus("offline");
        scheduleReconnect();
      });
    } catch (error) {
      if (disposed) return;
      onStatus("offline");
      scheduleReconnect();
    }
  }

  function scheduleReconnect() {
    if (retryTimer) clearTimeout(retryTimer);
    const delay = Math.min(1000 * Math.pow(2, retryCount), 15000);
    retryCount += 1;
    retryTimer = setTimeout(connect, delay);
  }

  connect();

  return function close() {
    disposed = true;
    if (retryTimer) clearTimeout(retryTimer);
    if (socketTask) socketTask.close({ code: 1000, reason: "page closed" });
    socketTask = null;
  };
}

module.exports = {
  connectScoreRealtime,
};
