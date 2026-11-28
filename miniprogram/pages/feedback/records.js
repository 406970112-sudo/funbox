const { clearSession } = require("../../utils/auth");

const STATUS_LABELS = {
  pending: "待处理",
  processing: "处理中",
  resolved: "已处理",
};

function dateLabel(value) {
  if (!value) return "";
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return "";
  const pad = (part) => String(part).padStart(2, "0");
  return `${time.getFullYear()}-${pad(time.getMonth() + 1)}-${pad(time.getDate())} ${pad(time.getHours())}:${pad(time.getMinutes())}`;
}

function buildRecord(item) {
  if (!item || !item.id) return null;
  const status = STATUS_LABELS[item.status] ? item.status : "pending";
  const adminReply = String(item.adminReply || "").trim();
  const description = String(item.description || "");
  return {
    id: item.id,
    status,
    statusLabel: STATUS_LABELS[status],
    title: item.title || description || "功能反馈",
    description,
    adminReply,
    unread: status === "resolved" && Boolean(adminReply) && !item.read,
    submittedAt: dateLabel(item.createdAt),
    repliedAt: dateLabel(item.replyUpdatedAt || item.processedAt),
    images: Array.isArray(item.images) ? item.images.filter((image) => image && image.id) : [],
  };
}

function redirectToFeedbackLogin(page, returnTo) {
  if (page.redirecting) return;
  page.redirecting = true;
  clearSession();
  wx.redirectTo({
    url: `/pages/auth/index?mode=login&returnTo=${encodeURIComponent(returnTo)}`,
  });
}

module.exports = { buildRecord, redirectToFeedbackLogin };
