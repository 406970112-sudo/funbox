const { getAccessToken, getStoredUser } = require("./auth");

const RECENT_ROOM_KEY = "funboxRecentScoreRoomV1";
const SESSION_KEY = "funboxScoreSessionV1";
const HOST_PASSWORD_KEY = "funboxHostScoreRoomPasswordsV1";

function getScoreSession() {
  const session = wx.getStorageSync(SESSION_KEY);
  return session && session.roomId && session.guestToken ? session : null;
}

function saveScoreSession(session) {
  wx.setStorageSync(SESSION_KEY, {
    roomId: session.roomId,
    guestToken: session.guestToken,
    participantId: session.participantId || "",
    savedAt: Date.now(),
    sessionId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
  });
}

function clearScoreSession() {
  wx.removeStorageSync(SESSION_KEY);
}

function clearRecentScoreRoom(roomId) {
  const recent = wx.getStorageSync(RECENT_ROOM_KEY);
  if (roomId && recent && recent.roomId === roomId) wx.removeStorageSync(RECENT_ROOM_KEY);
}

function saveRecentScoreRoom(room, credential) {
  if (!room || !room.id || !credential || !credential.token) return;
  let ownership;
  if (credential.kind === "guest") {
    const session = getScoreSession();
    if (!session || session.roomId !== room.id || session.guestToken !== credential.token) return;
    // Give legacy sessions a non-secret identity without duplicating the guest token.
    if (!session.sessionId) {
      saveScoreSession(session);
      return saveRecentScoreRoom(room, credential);
    }
    ownership = { credentialKind: "guest", guestSessionId: session.sessionId };
  } else if (credential.kind === "account") {
    const user = getStoredUser();
    if (!user || !user.id || credential.token !== getAccessToken()) return;
    ownership = { credentialKind: "account", userId: user.id };
  } else return;
  if (room.status === "settled" || room.status === "cancelled") {
    clearRecentScoreRoom(room.id);
    return;
  }
  if (room.status !== "waiting" && room.status !== "active") return;
  wx.setStorageSync(RECENT_ROOM_KEY, {
    roomId: room.id, name: room.name || "", gameType: room.gameType || "generic",
    status: room.status, ...ownership,
  });
}

function getRecentScoreRoom() {
  const recent = wx.getStorageSync(RECENT_ROOM_KEY);
  if (!recent || !recent.roomId || (recent.status !== "waiting" && recent.status !== "active")) return null;
  if (recent.credentialKind === "guest") {
    const session = getScoreSession();
    if (!session || session.roomId !== recent.roomId || !recent.guestSessionId || session.sessionId !== recent.guestSessionId) return null;
  } else if (recent.credentialKind === "account") {
    const user = getStoredUser();
    if (!getAccessToken() || !user || !user.id || user.id !== recent.userId) return null;
  } else return null;
  return recent;
}

function getHostPasswords() {
  const passwords = wx.getStorageSync(HOST_PASSWORD_KEY);
  return passwords && typeof passwords === "object" && !Array.isArray(passwords) ? passwords : {};
}

function saveHostRoomPassword(roomId, password) {
  if (!roomId || !password) return;
  const passwords = getHostPasswords();
  passwords[roomId] = { password: String(password), savedAt: Date.now() };
  wx.setStorageSync(HOST_PASSWORD_KEY, passwords);
}

function getHostRoomPassword(roomId) {
  if (!roomId) return "";
  const entry = getHostPasswords()[roomId];
  return entry && entry.password ? String(entry.password) : "";
}

function clearHostRoomPassword(roomId) {
  if (!roomId) return;
  const passwords = getHostPasswords();
  if (!passwords[roomId]) return;
  delete passwords[roomId];
  if (Object.keys(passwords).length) {
    wx.setStorageSync(HOST_PASSWORD_KEY, passwords);
  } else {
    wx.removeStorageSync(HOST_PASSWORD_KEY);
  }
}

function credentialForRoom(roomId, accessToken) {
  const stored = getScoreSession();
  if (stored && stored.roomId === roomId) {
    return { kind: "guest", token: stored.guestToken };
  }
  if (accessToken) {
    return { kind: "account", token: accessToken };
  }
  return null;
}

module.exports = {
  saveRecentScoreRoom,
  getRecentScoreRoom,
  clearRecentScoreRoom,
  clearHostRoomPassword,
  clearScoreSession,
  credentialForRoom,
  getHostRoomPassword,
  getScoreSession,
  saveHostRoomPassword,
  saveScoreSession,
};
