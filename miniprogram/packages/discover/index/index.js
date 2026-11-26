const { getAccessToken } = require("../../../utils/auth");
const { discoverPath, watchHolidayCard } = require("../../../utils/discover-entries");
const { reduceMotionEnabled } = require("../../../utils/ui-motion");

Page({
  data: { holidayCard: null, reduceMotion: false },

  onShow() {
    this.setData({ reduceMotion: reduceMotionEnabled() });
    this.stopHolidayCard();
    this._stopHolidayCard = watchHolidayCard(this);
  },

  onHide() { this.stopHolidayCard(); },

  onUnload() { this.stopHolidayCard(); },

  stopHolidayCard() {
    if (this._stopHolidayCard) this._stopHolidayCard();
    this._stopHolidayCard = null;
  },

  openNotebook() { wx.navigateTo({ url: discoverPath("notebook", Boolean(getAccessToken())) }); },

  openMemes() { wx.navigateTo({ url: discoverPath("memes") }); },

  openHolidays() { wx.navigateTo({ url: discoverPath("holidays") }); },

  openLottery() { wx.navigateTo({ url: discoverPath("lottery") }); },
});
