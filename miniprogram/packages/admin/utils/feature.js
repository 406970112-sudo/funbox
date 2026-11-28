const { PLACEMENT_LABELS } = require("./admin");

function featureView(feature) {
  const placements = feature.placements || [];
  const visiblePlacements = feature.visiblePlacements || [];
  return {
    ...feature,
    placements,
    visiblePlacements,
    placementLabel: placements.map((id) => PLACEMENT_LABELS[id] || id).join(" · "),
    statusLabel: !feature.enabled ? "入口已关闭"
      : feature.maintenance ? "维护中" : visiblePlacements.length ? "已展示" : "未展示",
    tone: !feature.enabled ? "muted" : feature.maintenance ? "maintenance" : visiblePlacements.length ? "success" : "muted",
  };
}

function featurePayload(feature, changes = {}) {
  return {
    enabled: feature.enabled,
    visiblePlacements: feature.visiblePlacements,
    audience: feature.audience,
    maintenance: feature.maintenance,
    revision: feature.revision,
    ...changes,
  };
}

module.exports = { featureView, featurePayload };
