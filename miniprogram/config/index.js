// 小程序与现有 Web 前端共用同一个 Go 后端。
// 生产环境由 www.xwhub.cn 反向代理到 backend 服务。
const API_BASE_URL = "https://www.xwhub.cn/api/v1";
const REQUEST_TIMEOUT = 15000;
const ACCESS_TOKEN_STORAGE_KEY = "accessToken";

module.exports = {
  API_BASE_URL,
  REQUEST_TIMEOUT,
  ACCESS_TOKEN_STORAGE_KEY,
};
