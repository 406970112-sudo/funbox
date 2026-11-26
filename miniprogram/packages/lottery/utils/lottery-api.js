const { request } = require("../../../utils/request");

const LATEST_CACHE_KEY = "funbox.lottery.latest.v1";

function historyCacheKey(game) {
  return `funbox.lottery.history.${game}.v1`;
}

function readCache(key) {
  try {
    if (typeof wx === "undefined" || typeof wx.getStorageSync !== "function") return null;
    return wx.getStorageSync(key) || null;
  } catch (error) {
    return null;
  }
}

function writeCache(key, value) {
  try {
    if (typeof wx !== "undefined" && typeof wx.setStorageSync === "function") {
      wx.setStorageSync(key, value);
    }
  } catch (error) {
    // Keep going without local storage.
  }
}

function getCachedLatest() {
  return readCache(LATEST_CACHE_KEY);
}

async function fetchLatestDraws() {
  try {
    const data = await request({ path: "/lottery/latest" });
    if (data && Array.isArray(data.games)) {
      writeCache(LATEST_CACHE_KEY, data);
      return data;
    }
    throw new Error("开奖数据格式异常");
  } catch (error) {
    const cached = readCache(LATEST_CACHE_KEY);
    if (cached && Array.isArray(cached.games)) {
      return { ...cached, stale: true, fromCache: true };
    }
    throw error;
  }
}

function getCachedHistory(game) {
  return readCache(historyCacheKey(game));
}

async function fetchGameHistory(game, { limit = 20, offset = 0, year = "", issue = "" } = {}) {
  const params = [`limit=${encodeURIComponent(String(limit))}`, `offset=${encodeURIComponent(String(offset))}`];
  if (year) params.push(`year=${encodeURIComponent(String(year))}`);
  if (issue) params.push(`issue=${encodeURIComponent(String(issue))}`);
  const path = `/lottery/games/${encodeURIComponent(game)}/history?${params.join("&")}`;
  try {
    const data = await request({ path });
    if (offset === 0 && !year && !issue && data && Array.isArray(data.draws)) {
      writeCache(historyCacheKey(game), data);
    }
    return data;
  } catch (error) {
    if (offset === 0 && !year && !issue) {
      const cached = readCache(historyCacheKey(game));
      if (cached && Array.isArray(cached.draws)) {
        return { ...cached, stale: true, fromCache: true };
      }
    }
    throw error;
  }
}

async function fetchIssueDetail(game, issue = "latest") {
  const path = `/lottery/games/${encodeURIComponent(game)}/issues/${encodeURIComponent(issue || "latest")}`;
  return request({ path });
}

function lotteryErrorMessage(error) {
  const code = error && error.data && error.data.error;
  if (code === "lottery_game_not_found") return "暂不支持该彩种查询。";
  if (code === "lottery_issue_not_found") return "未找到该期开奖记录。";
  if (code === "lottery_source_invalid" || code === "lottery_source_unavailable") {
    return "官方开奖数据源暂时繁忙，请稍后重试。";
  }
  return (error && error.message) || "加载失败，请检查网络后重试。";
}

module.exports = {
  getCachedLatest,
  fetchLatestDraws,
  getCachedHistory,
  fetchGameHistory,
  fetchIssueDetail,
  lotteryErrorMessage,
};
