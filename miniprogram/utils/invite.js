function extractInviteToken(value) {
  const text = String(value == null ? "" : value).trim();
  if (!text) return "";
  const queryMatch = text.match(/[?&]invite=([^&#]+)/i);
  if (queryMatch) {
    try {
      return decodeURIComponent(queryMatch[1]);
    } catch (error) {
      return queryMatch[1];
    }
  }
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(text)) {
    return text;
  }
  const sceneMatch = text.match(/(?:^|\?)scene=([^&#]+)/i);
  if (sceneMatch) {
    try {
      return decodeURIComponent(sceneMatch[1]);
    } catch (error) {
      return sceneMatch[1];
    }
  }
  return "";
}

function buildInviteContent(inviteToken) {
  return `/pages/score/room/index?invite=${encodeURIComponent(inviteToken)}`;
}

module.exports = {
  buildInviteContent,
  extractInviteToken,
};
