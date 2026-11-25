const REDUCE_MOTION_KEY = "funboxMahjongReducedMotionV1";

function reduceMotionEnabled() {
  try {
    return Boolean(wx.getStorageSync(REDUCE_MOTION_KEY));
  } catch (error) {
    // A reading failure should never prevent a page from opening.
    return false;
  }
}

function setReduceMotionEnabled(enabled) {
  wx.setStorageSync(REDUCE_MOTION_KEY, enabled);
}

module.exports = { reduceMotionEnabled, setReduceMotionEnabled };
