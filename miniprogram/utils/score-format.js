function parseYuanToCents(value) {
  const text = String(value == null ? "" : value).trim();
  if (!/^\d+(?:\.\d{0,2})?$/.test(text)) return null;
  const parts = text.split(".");
  const whole = Number(parts[0]);
  const fraction = Number((parts[1] || "").padEnd(2, "0"));
  const cents = whole * 100 + fraction;
  if (!Number.isSafeInteger(cents) || cents < 1 || cents > 1000000) return null;
  return cents;
}

function formatCNY(value) {
  const cents = Math.trunc(Number(value) || 0);
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  return `${sign}¥${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}

function formatScore(value) {
  const points = Math.trunc(Number(value) || 0);
  return points > 0 ? `+${points}` : String(points);
}

function parsePoints(value) {
  const text = String(value == null ? "" : value).trim();
  if (!/^\d+$/.test(text)) return null;
  const points = Number(text);
  if (!Number.isSafeInteger(points) || points < 1 || points > 2147483647) return null;
  return points;
}

function formatDistance(meters) {
  const value = Math.max(0, Math.trunc(Number(meters) || 0));
  if (value < 1000) return `${value} 米`;
  return `${(value / 1000).toFixed(value < 10000 ? 1 : 0)} 公里`;
}

function roomStatusLabel(status) {
  return {
    waiting: "等待开始",
    active: "牌局进行中",
    settled: "已结算",
    cancelled: "已取消",
  }[status] || "未知状态";
}

module.exports = {
  formatCNY,
  formatDistance,
  formatScore,
  parsePoints,
  parseYuanToCents,
  roomStatusLabel,
};
