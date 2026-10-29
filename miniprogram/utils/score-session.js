const SESSION_KEY = "funboxScoreSessionV1";

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
  clearScoreSession,
  credentialForRoom,
  getScoreSession,
  saveScoreSession,
};
