const { clearSession, getAccessToken } = require("../../utils/auth");
const { getFeedbackErrorMessage, submitFeedback } = require("../../utils/feedback-api");

const DRAFT_KEY = "funboxFeedbackDraftV1";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function runeLength(value) {
  return Array.from(String(value || "")).length;
}

Page({
  data: {
    description: "",
    descriptionCount: 0,
    image: null,
    errorMessage: "",
    submitting: false,
    submitted: false,
  },

  onLoad() {
    const draft = wx.getStorageSync(DRAFT_KEY);
    if (draft && typeof draft === "object") {
      const description = typeof draft.description === "string" ? draft.description : "";
      this.setData({
        description,
        descriptionCount: runeLength(description),
        image: draft.image || null,
      });
    }
  },

  onShow() {
    if (!getAccessToken()) this.redirectToAuth();
  },

  redirectToAuth() {
    if (this.redirecting) return;
    this.redirecting = true;
    wx.redirectTo({
      url: `/pages/auth/index?mode=login&returnTo=${encodeURIComponent("/pages/feedback/index")}`,
    });
  },

  saveDraft() {
    wx.setStorageSync(DRAFT_KEY, {
      description: this.data.description,
      image: this.data.image,
    });
  },

  handleDescription(event) {
    const description = event.detail.value;
    this.setData({
      description,
      descriptionCount: runeLength(description),
      errorMessage: "",
    });
    this.saveDraft();
  },

  chooseImage() {
    if (this.data.submitting) return;
    wx.chooseMedia({
      count: 1,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      sizeType: ["compressed"],
      success: (result) => {
        const file = result.tempFiles && result.tempFiles[0];
        if (!file || !file.tempFilePath) return;
        if (Number(file.size) > MAX_IMAGE_BYTES) {
          this.setData({ errorMessage: "截图不能超过 5 MB，请压缩后重试。" });
          return;
        }
        this.setData({
          image: {
            tempFilePath: file.tempFilePath,
            size: Number(file.size) || 0,
          },
          errorMessage: "",
        });
        this.saveDraft();
      },
      fail: (error) => {
        const message = String((error && error.errMsg) || "");
        if (!message.includes("cancel")) {
          this.setData({ errorMessage: "无法选择截图，请检查相册或相机权限。" });
        }
      },
    });
  },

  previewImage() {
    if (!this.data.image || !this.data.image.tempFilePath) return;
    wx.previewImage({
      current: this.data.image.tempFilePath,
      urls: [this.data.image.tempFilePath],
    });
  },

  removeImage() {
    this.setData({ image: null, errorMessage: "" });
    this.saveDraft();
  },

  async handleSubmit() {
    if (this.data.submitting) return;
    const description = this.data.description.trim();
    const length = runeLength(description);
    if (length < 10 || length > 1000) {
      this.setData({ errorMessage: "请填写 10～1000 个字符的问题描述。" });
      return;
    }
    if (!getAccessToken()) {
      this.saveDraft();
      this.redirectToAuth();
      return;
    }

    this.setData({ submitting: true, errorMessage: "" });
    try {
      await submitFeedback({ description, image: this.data.image });
      wx.removeStorageSync(DRAFT_KEY);
      this.setData({ submitting: false, submitted: true });
    } catch (error) {
      if (error && error.statusCode === 401) {
        clearSession();
        this.saveDraft();
        this.setData({ submitting: false, errorMessage: "登录状态已失效，请重新登录。" });
        setTimeout(() => this.redirectToAuth(), 500);
        return;
      }
      this.setData({
        submitting: false,
        errorMessage: getFeedbackErrorMessage(error),
      });
    }
  },

  goBack() {
    if (getCurrentPages().length > 1) {
      wx.navigateBack();
      return;
    }
    wx.switchTab({ url: "/pages/profile/index" });
  },
});
