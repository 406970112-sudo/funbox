const SITE_URL = "https://www.xwhub.cn/";

function createWebViewUrl(timestamp = Date.now()) {
  const separator = SITE_URL.includes("?") ? "&" : "?";

  return `${SITE_URL}${separator}source=wechat-miniprogram&_wv_t=${timestamp}`;
}

module.exports = {
  SITE_URL,
  createWebViewUrl,
};
