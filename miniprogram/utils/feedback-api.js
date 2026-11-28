const { getAccessToken } = require("./auth");
const { request, uploadFile } = require("./request");
const { API_BASE_URL, REQUEST_TIMEOUT } = require("../config/index");

function submitFeedback({ description, image }) {
  const token = getAccessToken();
  if (!token) {
    const error = new Error("请先登录后提交反馈。");
    error.code = "unauthorized";
    return Promise.reject(error);
  }
  if (image && image.tempFilePath) {
    return uploadFile({
      path: "/feedback",
      filePath: image.tempFilePath,
      name: "images",
      formData: {
        kind: "problem",
        description,
      },
      bearerToken: token,
    });
  }
  return request({
    path: "/feedback",
    method: "POST",
    bearerToken: token,
    data: {
      kind: "problem",
      description,
    },
  });
}

function listMyFeedback({ limit = 20, offset = 0, token = getAccessToken() } = {}) {
  return request({
    path: `/feedback/mine?limit=${limit}&offset=${offset}`,
    bearerToken: token,
  });
}

function getMyFeedback(feedbackId, token = getAccessToken()) {
  return request({
    path: `/feedback/${encodeURIComponent(feedbackId)}`,
    bearerToken: token,
  });
}

function markFeedbackRead(feedbackId, token = getAccessToken()) {
  if (!feedbackId) return Promise.resolve();
  return request({
    path: "/feedback/notifications/read",
    method: "POST",
    data: { feedbackIds: [feedbackId] },
    bearerToken: token,
  });
}

function downloadFeedbackImage(feedbackId, imageId, token = getAccessToken()) {
  const path = `/feedback/${encodeURIComponent(feedbackId)}/images/${encodeURIComponent(imageId)}`;
  return new Promise((resolve, reject) => {
    wx.downloadFile({
      url: `${API_BASE_URL}${path}`,
      header: { Authorization: `Bearer ${token}` },
      timeout: REQUEST_TIMEOUT,
      success(result) {
        if (result.statusCode === 200 && result.tempFilePath) {
          resolve(result.tempFilePath);
          return;
        }
        const error = new Error("截图加载失败，请重试。");
        error.statusCode = result.statusCode;
        reject(error);
      },
      fail() {
        reject(new Error("截图加载失败，请检查网络后重试。"));
      },
    });
  });
}

function getFeedbackErrorMessage(error) {
  const messages = {
    description_invalid: "描述需要填写 10～1000 个字符。",
    feedback_image_too_large: "截图不能超过 5 MB。",
    feedback_image_type_invalid: "截图仅支持 JPG、PNG 或 WebP 格式。",
    feedback_upload_too_large: "上传内容过大，请压缩截图后重试。",
    unauthorized: "登录状态已失效，请重新登录。",
    invalid_feedback_upload: "截图上传失败，请重新选择。",
    feedback_not_found: "没有找到这条反馈。",
    feedback_unavailable: "反馈服务暂不可用，请稍后重试。",
    list_feedback_failed: "反馈记录加载失败，请重试。",
  };
  return (error && messages[error.code]) || (error && error.message) || "反馈提交失败，请稍后重试。";
}

module.exports = {
  downloadFeedbackImage,
  getFeedbackErrorMessage,
  getMyFeedback,
  listMyFeedback,
  markFeedbackRead,
  submitFeedback,
};
