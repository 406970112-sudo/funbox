const { getAccessToken } = require("../../../utils/auth");
const { downloadFeedbackImage, getFeedbackErrorMessage, getMyFeedback, markFeedbackRead } = require("../../../utils/feedback-api");
const { buildRecord, redirectToFeedbackLogin } = require("../records");

const DETAIL_PATH = "/pages/feedback/detail/index";

Page({
  data: { item: null, loading: false, errorMessage: "", downloadingImage: "", imageError: "" },

  onLoad(options = {}) {
    this.feedbackId = typeof options.id === "string" ? options.id.trim() : "";
  },

  onShow() {
    return this.loadFeedback();
  },

  onUnload() {
    this.unloaded = true;
  },

  redirectToLogin() {
    this.setData({ item: null, downloadingImage: "", imageError: "" });
    redirectToFeedbackLogin(this, `${DETAIL_PATH}?id=${encodeURIComponent(this.feedbackId)}`);
  },

  async loadFeedback() {
    if (!this.feedbackId) {
      this.setData({ errorMessage: "没有找到这条反馈。" });
      return;
    }
    const token = getAccessToken();
    if (!token) {
      this.redirectToLogin();
      return;
    }
    if (this.sessionToken !== token) {
      this.sessionToken = token;
      this.setData({ item: null, downloadingImage: "", imageError: "" });
    }
    const requestID = (this.requestID || 0) + 1;
    this.requestID = requestID;
    const isCurrent = () => !this.unloaded && this.requestID === requestID && token === getAccessToken();
    this.setData({ loading: true, errorMessage: "" });
    try {
      const response = await getMyFeedback(this.feedbackId, token);
      if (!isCurrent()) return;
      const item = buildRecord(response.item);
      if (!item) {
        this.setData({ item: null, errorMessage: "没有找到这条反馈。" });
        return;
      }
      this.setData({ item });
      if (item.unread) {
        try {
          await markFeedbackRead(item.id, token);
          if (isCurrent()) this.setData({ item: { ...item, unread: false } });
        } catch (error) {
          if (isCurrent() && error.statusCode === 401) this.redirectToLogin();
        }
      }
    } catch (error) {
      if (!isCurrent()) return;
      if (error.statusCode === 401) {
        this.redirectToLogin();
        return;
      }
      this.setData({ item: null, errorMessage: getFeedbackErrorMessage(error) });
    } finally {
      if (!this.unloaded && this.requestID === requestID) this.setData({ loading: false });
    }
  },

  retryLoad() {
    return this.loadFeedback();
  },

  async previewImage(event) {
    const item = this.data.item;
    const imageId = event.currentTarget.dataset.id;
    const token = getAccessToken();
    if (!token || token !== this.sessionToken || this.data.downloadingImage) return;
    if (!item || !item.images.some((image) => image.id === imageId)) return;
    const isCurrent = () => !this.unloaded && token === getAccessToken();
    this.setData({ downloadingImage: imageId, imageError: "" });
    try {
      const path = await downloadFeedbackImage(item.id, imageId, token);
      if (isCurrent()) wx.previewImage({ current: path, urls: [path] });
    } catch (error) {
      if (!isCurrent()) return;
      if (error.statusCode === 401) {
        this.redirectToLogin();
        return;
      }
      this.setData({ imageError: error.message });
    } finally {
      if (isCurrent()) this.setData({ downloadingImage: "" });
    }
  },
});
