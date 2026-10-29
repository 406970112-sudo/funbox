const { getAccessToken } = require("./auth");
const { request, uploadFile } = require("./request");

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

function getFeedbackErrorMessage(error) {
  const messages = {
    description_invalid: "描述需要填写 10～1000 个字符。",
    feedback_image_too_large: "截图不能超过 5 MB。",
    feedback_image_type_invalid: "截图仅支持 JPG、PNG 或 WebP 格式。",
    feedback_upload_too_large: "上传内容过大，请压缩截图后重试。",
    unauthorized: "登录状态已失效，请重新登录。",
    invalid_feedback_upload: "截图上传失败，请重新选择。",
  };
  return (error && messages[error.code]) || (error && error.message) || "反馈提交失败，请稍后重试。";
}

module.exports = {
  getFeedbackErrorMessage,
  submitFeedback,
};
