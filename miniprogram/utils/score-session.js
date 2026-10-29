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
  });
}

function clearScoreSession() {
  wx.removeStorageSync(SESSION_KEY);
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
  clearHostRoomPassword,
  clearScoreSession,
  credentialForRoom,
  getHostRoomPassword,
  getScoreSession,
  saveHostRoomPassword,
  saveScoreSession,
};
