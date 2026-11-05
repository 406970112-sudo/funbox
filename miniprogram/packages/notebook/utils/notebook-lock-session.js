const { getAccessToken } = require("../../../utils/auth");

let session = null;

function clearUnlockSession() {
  session = null;
}

function setUnlockSession(token, expiresInSeconds) {
  const accessToken = getAccessToken();
  const seconds = Math.max(1, Number(expiresInSeconds) || 0);
  if (!accessToken || !token || seconds <= 0) {
    clearUnlockSession();
    return;
  }
  session = {
    token,
    accessToken,
    expiresAt: Date.now() + seconds * 1000,
  };
}

function getUnlockSession() {
  if (!session) return null;
  const accessToken = getAccessToken();
  if (!accessToken || session.accessToken !== accessToken || session.expiresAt <= Date.now()) {
    clearUnlockSession();
    return null;
  }
  return session;
}

function getUnlockToken() {
  const current = getUnlockSession();
  return current ? current.token : "";
}

function hasUnlockSession() {
  return Boolean(getUnlockSession());
}

module.exports = {
  clearUnlockSession,
  setUnlockSession,
  getUnlockSession,
  getUnlockToken,
  hasUnlockSession,
};
