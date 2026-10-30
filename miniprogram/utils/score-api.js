const { request } = require("./request");
const { clearSession, getAccessToken } = require("./auth");

const SCORE_ERROR_MESSAGES = {
  request_timeout: "网络请求超时，请检查网络后重试。",
  request_network_failed: "网络连接失败，请检查网络后重试。",
  score_action_forbidden: "当前身份不能执行这个操作。",
  score_action_id_reused: "操作标识已失效，请刷新后重试。",
  score_account_already_bound: "该账号已经加入了当前牌局，不能重复绑定。",
  score_balances_not_zero: "所有玩家的累计分数没有归零，暂时不能结算。",
  score_cap_exceeded: "本次给分超过房间封顶。",
  score_force_open_locked: "当前还不能强开。",
  score_invite_invalid: "这不是有效的房间邀请，请让房主重新分享。",
  score_invite_code_unavailable: "微信邀请码暂不可用，请使用房间码或转发邀请。",
  score_invalid_input: "请检查房间设置或分数输入。",
  score_invalid_state: "房间状态已经变化，请刷新后重试。",
  invalid_request_body: "服务端尚未更新，暂不支持当前房间参数。请部署最新后端后重试。",
  score_location_invalid: "位置信息无效，请重新定位。",
  score_nickname_conflict: "这个昵称已被房间内其他玩家使用。",
  score_not_found: "房间不存在或已经失效。",
  score_not_your_turn: "还没轮到你操作。",
  rate_limited: "操作太频繁，请稍后再试。",
  score_request_failed: "记分服务暂时不可用，请稍后重试。",
  score_room_forbidden: "你不在这个房间中。",
  score_room_full: "房间人数已满。",
  score_room_password_invalid: "房间密码不正确。",
  score_room_password_required: "请输入房间密码。",
  score_version_conflict: "房间已有新操作，数据已为你刷新。",
  unauthorized: "身份已失效，请重新加入房间。",
};

function bearerHeader(credential) {
  return credential && credential.token
    ? { Authorization: `Bearer ${credential.token}` }
    : {};
}

async function scoreRequest({ retryOnNetworkError = false, ...options }) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await request(options);
    } catch (error) {
      // Only explicitly marked reads may retry: a timed-out write may have committed.
      if (retryOnNetworkError && attempt === 0 && error.isNetworkError) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        continue;
      }
      const body = error && error.response && error.response.data;
      error.scoreCode = (body && body.error) || error.code || "";
      error.snapshot = body && body.room ? body.room : null;
      throw error;
    }
  }
}

function createScoreRoom(token, input) {
  return scoreRequest({
    path: "/score-rooms",
    method: "POST",
    bearerToken: token,
    data: input,
  });
}

function joinScoreRoom(input) {
  const token = getAccessToken();
  const options = {
    path: "/score-rooms/join",
    method: "POST",
    bearerToken: token,
    data: input,
  };
  return scoreRequest(options).catch(async (error) => {
    if (!token || error.statusCode !== 401) throw error;
    clearSession();
    return scoreRequest({ ...options, bearerToken: "" });
  });
}

function bindScoreParticipantAccount(roomId, participantToken) {
  return scoreRequest({
    path: `/score-rooms/${encodeURIComponent(roomId)}/bind-account`,
    method: "POST",
    bearerToken: getAccessToken(),
    data: { participantToken },
  }).then((response) => response.room);
}

function listScoreHistory({ limit = 5, offset = 0, from = "" } = {}) {
  const token = getAccessToken();
  const query = [
    "scope=participated",
    "status=settled",
    `limit=${encodeURIComponent(limit)}`,
    `offset=${encodeURIComponent(offset)}`,
  ];
  if (from) query.push(`from=${encodeURIComponent(from)}`);
  return scoreRequest({
    path: `/score-rooms/history?${query.join("&")}`,
    bearerToken: token,
  });
}

async function previewScoreInvite(inviteToken) {
  return previewScoreInviteCredential({ inviteToken });
}

async function previewScoreInviteScene(inviteScene) {
  return previewScoreInviteCredential({ inviteScene });
}

async function previewScoreInviteCredential(credential) {
  const token = getAccessToken();
  try {
    return await scoreRequest({
      path: "/score-rooms/invite-preview",
      method: "POST",
      retryOnNetworkError: true,
      bearerToken: token,
      data: credential,
    });
  } catch (error) {
    if (!token || error.statusCode !== 401) throw error;
    clearSession();
    return scoreRequest({
      path: "/score-rooms/invite-preview",
      method: "POST",
      retryOnNetworkError: true,
      data: credential,
    });
  }
}

function getScoreRoom(credential, roomId) {
  return scoreRequest({
    path: `/score-rooms/${encodeURIComponent(roomId)}`,
    retryOnNetworkError: true,
    bearerToken: credential.token,
    header: bearerHeader(credential),
  }).then((response) => response.room);
}

function listNearbyScoreRooms({ latitude, longitude, radiusMeters = 3000, gameType = "mahjong" }) {
  return scoreRequest({
    path: `/score-rooms/nearby?latitude=${encodeURIComponent(latitude)}&longitude=${encodeURIComponent(longitude)}&radiusMeters=${encodeURIComponent(radiusMeters)}&gameType=${encodeURIComponent(gameType)}`,
  }).then((response) => response.rooms || []);
}

function startScoreRoom(credential, room) {
  return mutateRoom(credential, room, "/start");
}

function submitScoreGifts(credential, room, allocations) {
  return mutateRoom(credential, room, "/gifts", { allocations });
}

function settleScoreRoom(credential, room, centsPerPoint) {
  return mutateRoom(credential, room, "/settle", {
    centsPerPoint,
    useSettlementRate: true,
  });
}

function issueScoreInviteToken(credential, roomId) {
  return scoreRequest({
    path: `/score-rooms/${encodeURIComponent(roomId)}/invite-token`,
    method: "POST",
    bearerToken: credential.token,
    header: bearerHeader(credential),
    data: {},
  }).then((response) => response.inviteToken);
}

function issueScoreInviteCode(credential, roomId) {
  return scoreRequest({
    path: `/score-rooms/${encodeURIComponent(roomId)}/invite-code`,
    method: "POST",
    bearerToken: credential.token,
    header: bearerHeader(credential),
    data: {},
  });
}

function createRealtimeTicket(credential, roomId) {
  return scoreRequest({
    path: `/score-rooms/${encodeURIComponent(roomId)}/realtime-ticket`,
    method: "POST",
    bearerToken: credential.token,
    header: bearerHeader(credential),
    data: {},
  }).then((response) => response.ticket);
}

async function mutateRoom(credential, room, suffix, extra, method = "POST") {
  const response = await scoreRequest({
    path: `/score-rooms/${encodeURIComponent(room.id)}${suffix}`,
    method,
    bearerToken: credential.token,
    header: bearerHeader(credential),
    data: {
      clientActionId: createClientActionId(),
      expectedRoomVersion: room.version,
      ...(extra || {}),
    },
  });
  return response.room;
}

function createClientActionId() {
  return `score-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function getScoreErrorMessage(error) {
  return (error && SCORE_ERROR_MESSAGES[error.scoreCode]) || (error && error.message) || "记分操作失败，请稍后重试。";
}

module.exports = {
  bindScoreParticipantAccount,
  createRealtimeTicket,
  createScoreRoom,
  getScoreErrorMessage,
  getScoreRoom,
  issueScoreInviteCode,
  issueScoreInviteToken,
  joinScoreRoom,
  listScoreHistory,
  listNearbyScoreRooms,
  mutateRoom,
  previewScoreInvite,
  previewScoreInviteScene,
  settleScoreRoom,
  startScoreRoom,
  submitScoreGifts,
};

function startPokerHand(c,r){return mutateRoom(c,r,'/zha-jin-hua/hands');}
function pokerAction(c,r,id,input){return mutateRoom(c,r,`/zha-jin-hua/hands/${encodeURIComponent(id)}/actions`,input);}
function confirmPokerBonuses(c,r,id,bonuses){return mutateRoom(c,r,`/zha-jin-hua/hands/${encodeURIComponent(id)}/bonus`,{bonuses});}
function managePokerMember(c,r,id,action){return mutateRoom(c,r,`/participants/${encodeURIComponent(id)}/seat`,{action});}
function updatePokerSettings(c,r,settings){return mutateRoom(c,r,'/zha-jin-hua/settings',{settings},'PATCH');}
Object.assign(module.exports,{startPokerHand,pokerAction,confirmPokerBonuses,managePokerMember,updatePokerSettings});

function cancelPokerHand(c,r,id){return mutateRoom(c,r,`/zha-jin-hua/hands/${encodeURIComponent(id)}/cancel`);}
module.exports.cancelPokerHand=cancelPokerHand;
