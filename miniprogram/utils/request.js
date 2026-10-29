const {
  API_BASE_URL,
  REQUEST_TIMEOUT,
  ACCESS_TOKEN_STORAGE_KEY,
} = require("../config/index");

function buildUrl(path) {
  return `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

function getErrorMessage(response) {
  const body = response && response.data;
  if (body && (body.detail || body.error || body.message)) {
    return body.detail || body.error || body.message;
  }
  return `请求失败（HTTP ${response.statusCode}）`;
}

function request({ path, method = "GET", data, auth = false, bearerToken = "", header = {} }) {
  return new Promise((resolve, reject) => {
    const token = bearerToken || (auth ? wx.getStorageSync(ACCESS_TOKEN_STORAGE_KEY) : "");
    const requestHeader = {
      "content-type": "application/json",
      ...header,
    };

    if (token) {
      requestHeader.Authorization = `Bearer ${token}`;
    }

    wx.request({
      url: buildUrl(path),
      method,
      data,
      header: requestHeader,
      timeout: REQUEST_TIMEOUT,
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(response.data);
          return;
        }

        const body = response && response.data;
        const error = new Error(getErrorMessage(response));
        error.statusCode = response.statusCode;
        error.response = response;
        error.code = body && body.error ? body.error : "";
        reject(error);
      },
      fail(error) {
        reject(new Error(error.errMsg || "网络请求失败，请稍后重试"));
      },
    });
  });
}

module.exports = {
  request,
};
