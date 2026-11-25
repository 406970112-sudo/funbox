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

function applyHolidayFilter(holidays, filter) {
  if (filter === "upcoming") return holidays.filter(item => !item.past);
  if (filter === "clean") return holidays.filter(item => !item.hasMakeup);
  if (filter === "makeup") return holidays.filter(item => item.hasMakeup);
  return holidays;
}

Page({
  data: {
    status: "loading",
    years: [],
    yearLabels: [],
    yearIndex: 0,
    selectedYear: 0,
    holidays: [],
    filteredHolidays: [],
    activeFilter: "all",
    expandedId: "",
    highlight: null,
    awaitingNotice: false,
    isMakeupDay: false,
    todayLabel: "",
    todayFullLabel: "",
    weekend: null,
    yearStats: null,
    source: null,
    copiedSource: false,
    copiedHighlight: false,
    copiedHolidayId: "",
    reduceMotion: false,
  },

  onShow() {
    this.setData({ reduceMotion: isReducedMotion(), copiedSource: false, copiedHighlight: false, copiedHolidayId: "" });
    this.refreshCalendar();
  },

  onHide() {
    this.stopCalendar();
    this.clearTimers();
  },

  onUnload() {
    this.stopCalendar();
    this.clearTimers();
  },

  clearTimers() {
    for (const key of ["_copyTimer", "_highlightCopyTimer", "_itemCopyTimer"]) {
      if (this[key]) clearTimeout(this[key]);
      this[key] = null;
    }
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

  renderCalendar(now = Date.now(), resetFilter = false) {
    const {
      years,
      selectedYear,
      holidays,
      upcoming,
      highlight,
      isMakeupDay,
      todayLabel,
      todayFullLabel,
      weekend,
      yearStats,
      source,
    } = getHolidayView(this._calendar, now, this._selectedYear);
    const activeFilter = resetFilter ? "all" : this.data.activeFilter;
    const filteredHolidays = applyHolidayFilter(holidays, activeFilter);
    const currentItem = holidays.find(item => item.current);
    const keepExpanded = !resetFilter && this.data.expandedId && holidays.some(item => item.id === this.data.expandedId);
    const expandedId = keepExpanded ? this.data.expandedId : (currentItem ? currentItem.id : "");

    this.setData({
      status: "ready",
      years,
      yearLabels: years.map(year => `${year} 年`),
      yearIndex: years.indexOf(selectedYear),
      selectedYear,
      holidays,
      filteredHolidays,
      activeFilter,
      expandedId,
      highlight,
      awaitingNotice: !upcoming && selectedYear === years[0],
      isMakeupDay,
      todayLabel,
      todayFullLabel,
      weekend,
      yearStats,
      source,
      copiedSource: false,
    });
  },

  selectYear(event) {
    const year = Number(event.currentTarget.dataset.year);
    if (!year || year === this.data.selectedYear || !this._calendar) return;
    this._selectedYear = year;
    this.renderCalendar(Date.now(), true);
  },

  onYearChange(event) {
    const year = this.data.years[Number(event.detail.value)];
    if (!year || !this._calendar) return;
    this._selectedYear = year;
    this.renderCalendar(Date.now(), true);
  },

  changeFilter(event) {
    const filter = event.currentTarget.dataset.filter || "all";
    if (filter === this.data.activeFilter) return;
    this.setData({
      activeFilter: filter,
      filteredHolidays: applyHolidayFilter(this.data.holidays, filter),
    });
  },

  resetFilter() {
    this.setData({
      activeFilter: "all",
      filteredHolidays: this.data.holidays,
    });
  },

  toggleHoliday(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    this.setData({ expandedId: this.data.expandedId === id ? "" : id });
  },

  noop() {},

  copyHighlight() {
    const highlight = this.data.highlight;
    if (!highlight) return;
    const prefix = highlight.state === "holiday"
      ? `${highlight.name}假期进行中（第 ${highlight.dayNumber}/${highlight.duration} 天）`
      : highlight.state === "tomorrow"
        ? `明天就是${highlight.name}放假啦`
        : `距离 ${highlight.year} 年${highlight.name}放假还有 ${highlight.daysUntil} 天`;
    const text = `${prefix}：${highlight.dateLabel}（${highlight.weekdayRange}，共 ${highlight.duration} 天），${highlight.hasMakeup ? `调休上班：${highlight.makeupDetailLabel}` : "无需调休"}`;
    wx.setClipboardData({
      data: text,
      success: () => {
        if (this._highlightCopyTimer) clearTimeout(this._highlightCopyTimer);
        this.setData({ copiedHighlight: true });
        this._highlightCopyTimer = setTimeout(() => {
          this._highlightCopyTimer = null;
          this.setData({ copiedHighlight: false });
        }, 2000);
      },
      fail: () => {
        if (typeof wx.showToast === "function") wx.showToast({ title: "复制失败，请重试", icon: "none" });
      },
    });
  },

  copyHolidayItem(event) {
    const id = event.currentTarget.dataset.id;
    const item = this.data.holidays.find(entry => entry.id === id);
    if (!item) return;
    wx.setClipboardData({
      data: item.copySummary,
      success: () => {
        if (this._itemCopyTimer) clearTimeout(this._itemCopyTimer);
        this.setData({ copiedHolidayId: id });
        this._itemCopyTimer = setTimeout(() => {
          this._itemCopyTimer = null;
          this.setData({ copiedHolidayId: "" });
        }, 2000);
      },
      fail: () => {
        if (typeof wx.showToast === "function") wx.showToast({ title: "复制失败，请重试", icon: "none" });
      },
    });
  },

  copySource() {
    if (!this.data.source) return;
    wx.setClipboardData({
      data: this.data.source.url,
      success: () => {
        if (this._copyTimer) clearTimeout(this._copyTimer);
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

  onShareAppMessage() {
    const h = this.data.highlight;
    const title = h
      ? (h.state === "holiday"
        ? `${h.name}假期进行中，共放假 ${h.duration} 天`
        : h.state === "tomorrow"
          ? `明天${h.name}放假啦！查看全年放假与调休`
          : `距离${h.name}放假还有 ${h.daysUntil} 天，查看全年调休安排`)
      : "FunBox 节假日倒计时 · 查看全年放假与调休";
    return { title, path: "/packages/discover/holidays/index" };
  },
});
