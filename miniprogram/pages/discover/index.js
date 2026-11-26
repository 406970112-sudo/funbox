const { getAccessToken } = require("../../utils/auth");
const { discoverPath, watchHolidayCard, recordRecentTool, getRecentTools } = require("../../utils/discover-entries");
const { reduceMotionEnabled } = require("../../utils/ui-motion");

Page({
  data: {
    holidayCard: null,
    reduceMotion: false,
    activeCategory: "all",
    recentTools: [],
  },

  onShow() {
    this.setData({
      reduceMotion: reduceMotionEnabled(),
      recentTools: getRecentTools(),
    });
    this.stopHolidayCard();
    this._stopHolidayCard = watchHolidayCard(this);
  },

  onHide() { this.stopHolidayCard(); },

  onUnload() { this.stopHolidayCard(); },

  stopHolidayCard() {
    if (this._stopHolidayCard) this._stopHolidayCard();
    this._stopHolidayCard = null;
  },

  selectCategory(event) {
    const category = event.currentTarget.dataset.category || "all";
    if (category !== this.data.activeCategory) {
      this.setData({ activeCategory: category });
    }
  },

  openRecentTool(event) {
    const id = event.currentTarget.dataset.id;
    if (id === "lottery") return this.openLottery();
    if (id === "holidays") return this.openHolidays();
    if (id === "notebook") return this.openNotebook();
    if (id === "memes") return this.openMemes();
  },

  openLottery() {
    recordRecentTool("lottery");
    wx.navigateTo({ url: discoverPath("lottery") });
  },

  openHolidays() {
    recordRecentTool("holidays");
    wx.navigateTo({ url: discoverPath("holidays") });
  },

  openNotebook() {
    recordRecentTool("notebook");
    wx.navigateTo({ url: discoverPath("notebook", Boolean(getAccessToken())) });
  },

  openMemes() {
    recordRecentTool("memes");
    wx.navigateTo({ url: discoverPath("memes") });
  },
});
