const { getAccessToken } = require("../../../utils/auth");
const { discoverPath, watchHolidayCard } = require("../../../utils/discover-entries");
const { reduceMotionEnabled } = require("../../../utils/ui-motion");
const { watchFeatureEntries, canOpenFeatureEntry } = require("../../../utils/feature-entries");

Page({
  data: { holidayCard: null, reduceMotion: false, featureEntries: {} },

  onShow() {
    this.setData({ reduceMotion: reduceMotionEnabled() });
    this.stopWatching();
    this._stopHolidayCard = watchHolidayCard(this);
    this._stopFeatureEntries = watchFeatureEntries("discover", featureEntries => this.setData({ featureEntries }));
  },

  onHide() { this.stopWatching(); },

  onUnload() { this.stopWatching(); },

  stopWatching() {
    if (this._stopHolidayCard) this._stopHolidayCard();
    if (this._stopFeatureEntries) this._stopFeatureEntries();
    this._stopHolidayCard = null;
    this._stopFeatureEntries = null;
  },

  openTool(id) {
    if (canOpenFeatureEntry(this.data.featureEntries[id])) {
      wx.navigateTo({ url: discoverPath(id, Boolean(getAccessToken())) });
    }
  },

  openNotebook() { this.openTool("notebook"); },

  openMemes() { this.openTool("memes"); },

  openHolidays() { this.openTool("holidays"); },

  openLottery() { this.openTool("lottery"); },
});
