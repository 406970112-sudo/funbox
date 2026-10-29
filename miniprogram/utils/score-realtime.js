const { API_BASE_URL } = require("../config/index");
const { createRealtimeTicket } = require("./score-api");

function realtimeURL(ticket) {
  const base = API_BASE_URL.replace(/^https:/i, "wss:").replace(/^http:/i, "ws:");
  return `${base}/realtime/ws?ticket=${encodeURIComponent(ticket)}`;
}

function failureReason(error) {
  const message = String(error && (error.errMsg || error.message || error.reason) || "");
  if (/domain list|not in domain/i.test(message)) return "domain";
  if ((error && error.statusCode === 401) || /\b401\b|unauthorized/i.test(message)) return "unauthorized";
  if ((error && error.statusCode === 403) || /\b403\b|origin_not_allowed/i.test(message)) return "forbidden";
  if (/ssl|tls|certificate/i.test(message)) return "tls";
  if (/timeout|timed out/i.test(message)) return "timeout";
  return "network";
}

function connectScoreRealtime({ credential, roomId, onInvalidate, onStatus }) {
  let disposed = false;
  let socketTask = null;
  let retryTimer = null;
  let connectTimer = null;
  let retryCount = 0;
  let generation = 0;
  let networkAvailable = true;

  function closeTask(task) {
    if (!task) return;
    try {
      task.close({ code: 1000, reason: "connection reset" });
    } catch (error) {
      // A failed or pending native socket may already be closed.
    }
  }

  function resetConnection() {
    generation += 1;
    if (retryTimer) clearTimeout(retryTimer);
    if (connectTimer) clearTimeout(connectTimer);
    retryTimer = null;
    connectTimer = null;
    const task = socketTask;
    socketTask = null;
    closeTask(task);
  }

  async function connect() {
    if (disposed || !networkAvailable) return;
    resetConnection();
    const currentGeneration = generation;
    let finished = false;
    let task = null;
    const isCurrent = () => !finished && !disposed && currentGeneration === generation;
    const handleDisconnect = (error) => {
      if (!isCurrent()) return;
      finished = true;
      if (connectTimer) clearTimeout(connectTimer);
      connectTimer = null;
      if (socketTask === task) socketTask = null;
      onStatus("offline", failureReason(error));
      scheduleReconnect();
      closeTask(task);
    };

    onStatus("connecting");
    try {
      const ticket = await createRealtimeTicket(credential, roomId);
      if (!isCurrent()) return;
      connectTimer = setTimeout(() => handleDisconnect({ errMsg: "timeout" }), 10000);
      task = wx.connectSocket({
        url: realtimeURL(ticket),
        // Normalize the native client's Origin to the API's allowed web origin.
        header: { Origin: API_BASE_URL.split("/").slice(0, 3).join("/") },
        fail: handleDisconnect,
      });
      if (!isCurrent()) {
        closeTask(task);
        return;
      }
      socketTask = task;

      task.onOpen(() => {
        if (!isCurrent()) {
          closeTask(task);
          return;
        }
        if (connectTimer) clearTimeout(connectTimer);
        connectTimer = null;
        retryCount = 0;
        onStatus("online");
      });
      task.onMessage((message) => {
        if (!isCurrent()) return;
        try {
          const event = JSON.parse(String(message.data));
          if (event.type === "score.room.updated" && event.data && event.data.roomId === roomId) {
            onInvalidate(event.data.roomVersion || 0, event.data.sequence || 0);
          }
        } catch (error) {
          // REST snapshots remain authoritative when an event cannot be decoded.
        }
      });
      task.onError(handleDisconnect);
      task.onClose(handleDisconnect);
    } catch (error) {
      handleDisconnect();
    }
  }

  function scheduleReconnect() {
    if (disposed || !networkAvailable || retryTimer) return;
    const delay = Math.min(1000 * Math.pow(2, retryCount), 15000);
    retryCount += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      connect();
    }, delay);
  }

  const handleNetworkChange = ({ isConnected }) => {
    if (disposed) return;
    networkAvailable = isConnected;
    if (!isConnected) {
      resetConnection();
      onStatus("offline", "network");
      return;
    }
    retryCount = 0;
    connect();
  };
  if (wx.onNetworkStatusChange) wx.onNetworkStatusChange(handleNetworkChange);

  connect();

  return function close() {
    disposed = true;
    resetConnection();
    if (wx.offNetworkStatusChange) wx.offNetworkStatusChange(handleNetworkChange);
  };
}

module.exports = {
  connectScoreRealtime,
};
