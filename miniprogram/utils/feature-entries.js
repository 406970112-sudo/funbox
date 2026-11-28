const { getAccessToken, getStoredUser } = require("./auth");
const { request } = require("./request");

const STORAGE_KEY = "funbox.feature-entries.v1";
const DISCOVER_PLACEMENTS = ["home", "discover", "recent"];
const PERSONAL_DISCOVER_PLACEMENTS = [...DISCOVER_PLACEMENTS, "profile"];
const PLACEMENTS = {
  mahjong: ["home"],
  poker: ["home"],
  general: ["home"],
  "room-join": ["home", "score"],
  "room-resume": ["home"],
  website: ["home"],
  "game-history": ["profile"],
  feedback: ["profile"],
  notebook: PERSONAL_DISCOVER_PLACEMENTS,
  memes: PERSONAL_DISCOVER_PLACEMENTS,
  holidays: DISCOVER_PLACEMENTS,
  lottery: DISCOVER_PLACEMENTS,
};
const AUDIENCES = ["all", "signed_in", "vip", "svip"];
const ROLES = ["", "normal", "vip", "svip", "admin"];

let policies;
let viewer;
let pending;

function currentToken() {
  return typeof wx !== "undefined" && typeof wx.getStorageSync === "function" ? getAccessToken() : "";
}

function currentRole(token) {
  if (!token) return "";
  if (viewer && viewer.token === token) return viewer.role;
  const account = getStoredUser();
  return (account && account.role) || "normal";
}

function normalizePolicies(features) {
  const valid = {};
  if (!Array.isArray(features)) return valid;
  for (const feature of features) {
    if (!feature || !Object.prototype.hasOwnProperty.call(PLACEMENTS, feature.id) ||
        typeof feature.enabled !== "boolean" || typeof feature.maintenance !== "boolean" ||
        !AUDIENCES.includes(feature.audience) || !Array.isArray(feature.visiblePlacements)) continue;
    valid[feature.id] = {
      id: feature.id,
      enabled: feature.enabled,
      maintenance: feature.maintenance,
      audience: feature.audience,
      visiblePlacements: PLACEMENTS[feature.id].filter(placement => feature.visiblePlacements.includes(placement)),
    };
  }
  return valid;
}

function getPolicies() {
  if (policies) return policies;
  if (typeof wx === "undefined" || typeof wx.getStorageSync !== "function") return {};
  try {
    policies = normalizePolicies(wx.getStorageSync(STORAGE_KEY));
  } catch (error) {
    policies = {};
  }
  return policies;
}

function refreshPolicies(token) {
  if (typeof wx === "undefined" || typeof wx.request !== "function") return Promise.resolve("failed");
  if (pending && pending.token === token) return pending.result;
  const active = { token };
  pending = active;
  active.result = request({ path: "/miniprogram/features", bearerToken: token }).then(response => {
    if (pending !== active || currentToken() !== token) return "failed";
    const next = normalizePolicies(response && response.features);
    if (!Object.keys(next).length) return "failed";
    policies = { ...getPolicies(), ...next };
    if (ROLES.includes(response.viewerRole)) viewer = { token, role: response.viewerRole };
    try {
      wx.setStorageSync(STORAGE_KEY, Object.values(policies));
    } catch (error) {
      // In-memory updates still work when storage is unavailable.
    }
    return "live";
  }).catch(error => {
    if (error.statusCode === 401 && pending === active && currentToken() === token) viewer = { token, role: "" };
    return "failed";
  }).finally(() => {
    if (pending === active) pending = null;
  });
  return active.result;
}

function watchPolicies(update) {
  const token = currentToken();
  let active = true;
  const snapshot = getPolicies();
  update(snapshot, currentRole(token), Object.keys(snapshot).length ? "cached" : "defaults");
  refreshPolicies(token).then(source => {
    if (active && currentToken() === token) update(getPolicies(), currentRole(token), source);
  });
  return () => { active = false; };
}

function allowsAudience(audience, role) {
  switch (audience) {
    case "signed_in": return Boolean(role) && ROLES.includes(role);
    case "vip": return role === "vip" || role === "svip";
    case "svip": return role === "svip";
    default: return true;
  }
}

function watchFeatureAccess(id, update) {
  return watchPolicies((snapshot, role, source) => {
    const policy = snapshot[id];
    const status = !policy || allowsAudience(policy.audience, role) ? "available" : "restricted";
    update(policy && policy.maintenance ? "maintenance" : status, source);
  });
}

function watchFeatureEntries(placement, update) {
  let lastEntries;
  return watchPolicies((snapshot, role, source) => {
    const entries = {};
    for (const [id, supported] of Object.entries(PLACEMENTS)) {
      if (!supported.includes(placement)) continue;
      const key = id.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      const policy = snapshot[id];
      if (!policy) {
        entries[key] = id === "website" ? "hidden" : "visible";
        continue;
      }
      if (!policy.enabled || !policy.visiblePlacements.includes(placement) || !allowsAudience(policy.audience, role)) {
        entries[key] = "hidden";
      } else {
        entries[key] = policy.maintenance ? "maintenance" : "visible";
      }
    }
    if (lastEntries && Object.keys(entries).every(key => entries[key] === lastEntries[key])) return;
    lastEntries = entries;
    update(entries, source);
  });
}

function canOpenFeatureEntry(status) {
  if (status === "maintenance") {
    wx.showToast({ title: "该功能维护中，请稍后再试", icon: "none" });
  }
  return status !== "hidden" && status !== "maintenance";
}

module.exports = { watchFeatureEntries, watchFeatureAccess, canOpenFeatureEntry };
