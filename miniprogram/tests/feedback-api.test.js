const test = require("node:test");
const assert = require("node:assert/strict");

const storage = { accessToken: "feedback-token" };
const requestCalls = [];
const uploadCalls = [];

global.wx = {
  getStorageSync(key) {
    return storage[key] || "";
  },
  request(options) {
    requestCalls.push(options);
    options.success({ statusCode: 201, data: { id: "feedback-1" } });
  },
  uploadFile(options) {
    uploadCalls.push(options);
    options.success({ statusCode: 201, data: JSON.stringify({ id: "feedback-2" }) });
  },
};

const { getFeedbackErrorMessage, submitFeedback } = require("../utils/feedback-api");

test("feedback without a screenshot submits the description as JSON with authentication", async () => {
  requestCalls.length = 0;
  const result = await submitFeedback({ description: "页面在结算后一直显示加载中" });
  assert.equal(result.id, "feedback-1");
  assert.equal(requestCalls.length, 1);
  assert.equal(requestCalls[0].url.endsWith("/feedback"), true);
  assert.equal(requestCalls[0].header.Authorization, "Bearer feedback-token");
  assert.deepEqual(requestCalls[0].data, {
    kind: "problem",
    description: "页面在结算后一直显示加载中",
  });
});

test("feedback with a screenshot uploads it through the existing multipart endpoint", async () => {
  uploadCalls.length = 0;
  const result = await submitFeedback({
    description: "页面在结算后一直显示加载中",
    image: { tempFilePath: "wxfile://feedback.png", size: 1024 },
  });
  assert.equal(result.id, "feedback-2");
  assert.equal(uploadCalls.length, 1);
  assert.equal(uploadCalls[0].url.endsWith("/feedback"), true);
  assert.equal(uploadCalls[0].name, "images");
  assert.equal(uploadCalls[0].filePath, "wxfile://feedback.png");
  assert.equal(uploadCalls[0].header.Authorization, "Bearer feedback-token");
  assert.deepEqual(uploadCalls[0].formData, {
    kind: "problem",
    description: "页面在结算后一直显示加载中",
  });
});

test("feedback errors map to actionable Chinese messages", () => {
  assert.match(getFeedbackErrorMessage({ code: "feedback_image_too_large" }), /5 MB/);
  assert.match(getFeedbackErrorMessage({ code: "description_invalid" }), /10～1000/);
});
