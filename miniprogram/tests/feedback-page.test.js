const test = require("node:test");
const assert = require("node:assert/strict");

let accessToken = "account-token";
let submitCalls = [];
let submitError = null;
const storage = {};
const redirects = [];

const authPath = require.resolve("../utils/auth");
require.cache[authPath] = {
  id: authPath,
  filename: authPath,
  loaded: true,
  exports: {
    clearSession() {
      accessToken = "";
    },
    getAccessToken: () => accessToken,
  },
};

const feedbackAPIPath = require.resolve("../utils/feedback-api");
require.cache[feedbackAPIPath] = {
  id: feedbackAPIPath,
  filename: feedbackAPIPath,
  loaded: true,
  exports: {
    getFeedbackErrorMessage: (error) => error.message,
    submitFeedback: async (input) => {
      submitCalls.push(input);
      if (submitError) throw submitError;
      return { id: "feedback-1" };
    },
  },
};

global.wx = {
  chooseMedia(options) {
    options.success({ tempFiles: [{ tempFilePath: "wxfile://screenshot.png", size: 2048 }] });
  },
  getStorageSync(key) {
    return storage[key] || "";
  },
  previewImage() {},
  redirectTo(options) {
    redirects.push(options);
  },
  removeStorageSync(key) {
    delete storage[key];
  },
  setStorageSync(key, value) {
    storage[key] = value;
  },
  showToast() {},
};
global.getCurrentPages = () => [{}, {}];

let pageDefinition;
global.Page = (definition) => {
  pageDefinition = definition;
};
require("../pages/feedback/index");

function createPage(data) {
  return {
    ...pageDefinition,
    data: { ...pageDefinition.data, ...data },
    setData(patch, callback) {
      this.data = { ...this.data, ...patch };
      if (callback) callback();
    },
  };
}

test("feedback page chooses one screenshot and blocks files over five megabytes", () => {
  accessToken = "account-token";
  const page = createPage();
  page.chooseImage();
  assert.equal(page.data.image.tempFilePath, "wxfile://screenshot.png");

  global.wx.chooseMedia = (options) => {
    options.success({ tempFiles: [{ tempFilePath: "wxfile://large.png", size: 6 * 1024 * 1024 }] });
  };
  page.chooseImage();
  assert.equal(page.data.image.tempFilePath, "wxfile://screenshot.png");
  assert.match(page.data.errorMessage, /5 MB/);
});

test("feedback page validates description and submits screenshot and text", async () => {
  accessToken = "account-token";
  submitCalls = [];
  submitError = null;
  const page = createPage({
    description: "结算之后页面一直显示加载中，请帮忙检查",
    descriptionCount: 20,
    image: { tempFilePath: "wxfile://screenshot.png", size: 2048 },
  });
  await page.handleSubmit();
  assert.equal(submitCalls.length, 1);
  assert.equal(submitCalls[0].description, "结算之后页面一直显示加载中，请帮忙检查");
  assert.equal(submitCalls[0].image.tempFilePath, "wxfile://screenshot.png");
  assert.equal(page.data.submitted, true);

  const invalidPage = createPage({ description: "太短", descriptionCount: 2 });
  await invalidPage.handleSubmit();
  assert.equal(submitCalls.length, 1);
  assert.match(invalidPage.data.errorMessage, /10～1000/);
});

test("feedback page redirects unauthenticated users to login", () => {
  accessToken = "";
  redirects.length = 0;
  const page = createPage();
  page.onShow();
  assert.equal(redirects.length, 1);
  assert.match(redirects[0].url, /mode=login/);
  assert.match(redirects[0].url, /returnTo=/);
});
