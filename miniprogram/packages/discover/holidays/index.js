const { getHolidayView, watchHolidayCalendar } = require("../../../utils/holiday-calendar");

function isReducedMotion() {
  try {
    return typeof wx !== "undefined" && typeof wx.getStorageSync === "function"
      ? Boolean(wx.getStorageSync("funboxMahjongReducedMotionV1"))
      : false;
  } catch (error) {
    return false;
  }
}

Page({
  data: {
    status: "loading",
    years: [],
    yearLabels: [],
    yearIndex: 0,
    selectedYear: 0,
    holidays: [],
    highlight: null,
    awaitingNotice: false,
    isMakeupDay: false,
    todayLabel: "",
    todayFullLabel: "",
    yearStats: null,
    source: null,
    copiedSource: false,
    reduceMotion: false,
  },

  onShow() {
    this.setData({ reduceMotion: isReducedMotion(), copiedSource: false });
    this.refreshCalendar();
  },

  onHide() {
    this.stopCalendar();
    this.clearCopyTimer();
  },

  onUnload() {
    this.stopCalendar();
    this.clearCopyTimer();
  },

  clearCopyTimer() {
    if (this._copyTimer) clearTimeout(this._copyTimer);
    this._copyTimer = null;
  },

  stopCalendar() {
    if (this._stopCalendar) this._stopCalendar();
    this._stopCalendar = null;
  },

  refreshCalendar() {
    this.stopCalendar();
    this._stopCalendar = watchHolidayCalendar(({ calendar, now, status }) => {
      this._calendar = calendar;
      if (!calendar) {
        this.setData({ status });
        return;
      }
      this.renderCalendar(now);
    });
  },

  renderCalendar(now = Date.now()) {
    const {
      years,
      selectedYear,
      holidays,
      upcoming,
      highlight,
      isMakeupDay,
      todayLabel,
      todayFullLabel,
      yearStats,
      source,
    } = getHolidayView(this._calendar, now, this._selectedYear);
    this.setData({
      status: "ready",
      years,
      yearLabels: years.map(year => `${year} 年`),
      yearIndex: years.indexOf(selectedYear),
      selectedYear,
      holidays,
      highlight,
      awaitingNotice: !upcoming && selectedYear === years[0],
      isMakeupDay,
      todayLabel,
      todayFullLabel,
      yearStats,
      source,
      copiedSource: false,
    });
  },

  selectYear(event) {
    const year = Number(event.currentTarget.dataset.year);
    if (!year || year === this.data.selectedYear || !this._calendar) return;
    this._selectedYear = year;
    this.renderCalendar();
  },

  onYearChange(event) {
    const year = this.data.years[Number(event.detail.value)];
    if (!year || !this._calendar) return;
    this._selectedYear = year;
    this.renderCalendar();
  },

  copySource() {
    if (!this.data.source) return;
    wx.setClipboardData({
      data: this.data.source.url,
      success: () => {
        this.clearCopyTimer();
        this.setData({ copiedSource: true });
        this._copyTimer = setTimeout(() => {
          this._copyTimer = null;
          this.setData({ copiedSource: false });
        }, 2000);
      },
      fail: () => {
        if (typeof wx.showToast === "function") {
          wx.showToast({ title: "复制失败，请重试", icon: "none" });
        }
      },
    });
  },
});
