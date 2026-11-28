const { getAccessToken } = require("../../utils/auth");
const { discoverPath, watchHolidayCard, recordRecentTool, getRecentTools, TOOL_CATALOG } = require("../../utils/discover-entries");
const { reduceMotionEnabled } = require("../../utils/ui-motion");
const { watchFeatureEntries, canOpenFeatureEntry } = require("../../utils/feature-entries");

Page({
  data: {
    holidayCard: null,
    reduceMotion: false,
    activeCategory: "all",
    recentTools: [],
    featureEntries: {},
    recentFeatureEntries: {},
    toolGroups: { life: false, notes: false, fun: false },
  },

  onShow() {
    this.setData({
      reduceMotion: reduceMotionEnabled(),
    });
    this.stopHolidayCard();
    this._stopHolidayCard = watchHolidayCard(this);
    this.stopFeatureEntries();
    this._stopFeatureEntries = [
      watchFeatureEntries("discover", featureEntries => {
        const toolGroups = {
          life: featureEntries.lottery !== "hidden" || featureEntries.holidays !== "hidden",
          notes: featureEntries.notebook !== "hidden",
          fun: featureEntries.memes !== "hidden",
        };
        this.setData({ featureEntries, toolGroups });
      }),
      watchFeatureEntries("recent", recentFeatureEntries => {
        const recentTools = getRecentTools().filter(tool => recentFeatureEntries[tool.id] !== "hidden");
        this.setData({ recentFeatureEntries, recentTools });
      }),
    ];
  },

  onHide() {
    this.stopHolidayCard();
    this.stopFeatureEntries();
  },

  onUnload() { this.onHide(); },

  stopHolidayCard() {
    if (this._stopHolidayCard) this._stopHolidayCard();
    this._stopHolidayCard = null;
  },

  stopFeatureEntries() {
    for (const stop of this._stopFeatureEntries || []) stop();
    this._stopFeatureEntries = [];
  },

  selectCategory(event) {
    const category = event.currentTarget.dataset.category || "all";
    if (category !== this.data.activeCategory) {
      this.setData({ activeCategory: category });
    }
  },

  openRecentTool(event) {
    this.openTool(event.currentTarget.dataset.id, this.data.recentFeatureEntries);
  },

  openTool(id, entries = this.data.featureEntries) {
    if (!TOOL_CATALOG.some(tool => tool.id === id) || !canOpenFeatureEntry(entries[id])) return;
    recordRecentTool(id);
    wx.navigateTo({ url: discoverPath(id, id === "notebook" && Boolean(getAccessToken())) });
  },

  openLottery() { this.openTool("lottery"); },

  openHolidays() { this.openTool("holidays"); },

  openNotebook() { this.openTool("notebook"); },

  openMemes() { this.openTool("memes"); },
});
