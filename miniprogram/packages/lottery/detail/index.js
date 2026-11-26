const {
  getGameMeta,
  decorateDraw,
  getCheckerConfig,
  evaluateTicket,
} = require("../utils/lottery-format");
const { fetchIssueDetail, lotteryErrorMessage } = require("../utils/lottery-api");

function createEmptySelection(config) {
  if (config.mode === "pool") {
    return { front: [], back: [] };
  }
  if (config.mode === "qxc") {
    return {
      positions: config.positions.map(() => ""),
      back: [],
    };
  }
  return {
    positions: config.positions.map(() => ""),
  };
}

function normalizeStr(val, padTwo) {
  const n = Number(String(val || "").trim());
  if (!Number.isFinite(n)) return String(val || "").trim();
  return padTwo ? String(n).padStart(2, "0") : String(n);
}

function buildCheckerView(game, draw, selection) {
  const config = getCheckerConfig(game);
  const evalResult = evaluateTicket(game, draw, selection);
  const view = {
    mode: config.mode,
    frontLabel: config.frontLabel || "",
    backLabel: config.backLabel || "",
    frontCount: config.frontCount || 0,
    backCount: config.backCount || 0,
    frontKind: config.frontKind || "red",
    backKind: config.backKind || "blue",
    frontSelectedCount: 0,
    backSelectedCount: 0,
    hasAnySelection: false,
    frontItems: [],
    backItems: [],
    positionRows: [],
    evalResult,
  };

  if (config.mode === "pool") {
    const drawFront = new Set((draw && draw.front || []).map(v => normalizeStr(v, true)));
    const drawBack = new Set((draw && draw.back || []).map(v => normalizeStr(v, true)));
    const pickedFront = new Set((selection.front || []).map(v => normalizeStr(v, true)));
    const pickedBack = new Set((selection.back || []).map(v => normalizeStr(v, true)));
    view.frontSelectedCount = pickedFront.size;
    view.backSelectedCount = pickedBack.size;
    view.hasAnySelection = pickedFront.size > 0 || pickedBack.size > 0;
    view.frontItems = config.frontNumbers.map(n => ({
      n,
      selected: pickedFront.has(n),
      hit: pickedFront.has(n) && (drawFront.has(n) || (game === "qlc" && drawBack.has(n))),
    }));
    view.backItems = config.backNumbers.map(n => ({
      n,
      selected: pickedBack.has(n),
      hit: pickedBack.has(n) && drawBack.has(n),
    }));
    return view;
  }

  const drawFront = (draw && draw.front || []).map(v => normalizeStr(v, false));
  const positions = selection.positions || config.positions.map(() => "");
  view.positionRows = config.positions.map((label, idx) => {
    const picked = positions[idx] != null ? String(positions[idx]) : "";
    const target = drawFront[idx];
    return {
      index: idx,
      label,
      picked,
      matched: picked !== "" && picked === target,
      digits: config.digitNumbers.map(n => ({
        n,
        selected: picked === n,
        hit: picked === n && n === target,
      })),
    };
  });

  if (config.mode === "qxc") {
    const drawBack = normalizeStr(draw && draw.back && draw.back[0], false);
    const pickedBack = (selection.back && selection.back[0]) != null ? String(selection.back[0]) : "";
    view.backSelectedCount = pickedBack !== "" ? 1 : 0;
    view.backItems = config.backNumbers.map(n => ({
      n,
      selected: pickedBack === n,
      hit: pickedBack === n && n === drawBack,
    }));
    view.hasAnySelection = positions.some(v => v !== "") || pickedBack !== "";
  } else {
    view.hasAnySelection = positions.some(v => v !== "");
  }

  return view;
}

Page({
  data: {
    game: "ssq",
    issue: "latest",
    gameMeta: getGameMeta("ssq"),
    sourceName: "中国福彩网",
    sourceUrl: "https://www.cwl.gov.cn",
    draw: null,
    prevIssue: "",
    nextIssue: "",
    loading: true,
    errorMessage: "",
    checkerOpen: true,
    checker: null,
  },

  onLoad(options = {}) {
    const meta = getGameMeta(options.game || "ssq");
    const issue = options.issue || "latest";
    const config = getCheckerConfig(meta.game);
    this._selection = createEmptySelection(config);
    this.setData({
      game: meta.game,
      issue,
      gameMeta: meta,
      sourceName: meta.org === "cwl" ? "中国福彩网" : "中国体彩网",
      sourceUrl: meta.org === "cwl" ? "https://www.cwl.gov.cn" : "https://www.lottery.gov.cn",
    });
    if (typeof wx.setNavigationBarTitle === "function") {
      wx.setNavigationBarTitle({ title: `${meta.shortName}开奖详情` });
    }
    return this.loadIssue(meta.game, issue);
  },

  async loadIssue(game, issue) {
    const token = (this._reqSeq || 0) + 1;
    this._reqSeq = token;
    this.setData({ loading: true, errorMessage: "" });
    try {
      const res = await fetchIssueDetail(game, issue);
      if (this._reqSeq !== token) return;
      const meta = getGameMeta(res.game || game);
      const draw = decorateDraw({
        ...res.draw,
        game: meta.game,
        org: res.org || meta.org,
        orgName: res.orgName || meta.orgName,
        name: res.name || meta.name,
        schedule: res.schedule || meta.schedule,
      });
      if (!this._selection) {
        this._selection = createEmptySelection(getCheckerConfig(meta.game));
      }
      this.setData({
        game: meta.game,
        issue: draw ? draw.issue : issue,
        gameMeta: meta,
        sourceName: res.sourceName || (meta.org === "cwl" ? "中国福彩网" : "中国体彩网"),
        sourceUrl: res.sourceUrl || (meta.org === "cwl" ? "https://www.cwl.gov.cn" : "https://www.lottery.gov.cn"),
        draw,
        prevIssue: res.prevIssue || "",
        nextIssue: res.nextIssue || "",
        checker: buildCheckerView(meta.game, draw, this._selection),
        loading: false,
        errorMessage: "",
      });
    } catch (error) {
      if (this._reqSeq !== token) return;
      this.setData({
        loading: false,
        errorMessage: lotteryErrorMessage(error),
      });
    }
  },

  goPrevIssue() {
    if (!this.data.prevIssue || this.data.loading) return;
    this.loadIssue(this.data.game, this.data.prevIssue);
  },

  goNextIssue() {
    if (!this.data.nextIssue || this.data.loading) return;
    this.loadIssue(this.data.game, this.data.nextIssue);
  },

  retryLoad() {
    this.loadIssue(this.data.game, this.data.issue);
  },

  openHistory() {
    wx.navigateTo({
      url: `/packages/lottery/history/index?game=${encodeURIComponent(this.data.game)}`,
    });
  },

  copyDrawSummary() {
    const draw = this.data.draw;
    if (!draw) return;
    const frontText = (draw.front || []).join(" ");
    const backText = (draw.back || []).length ? ` + ${(draw.back || []).join(" ")}` : "";
    const text = `${draw.name} 第${draw.issue}期（${draw.date}）开奖号码：${frontText}${backText}`;
    wx.setClipboardData({
      data: text,
      success() {
        wx.showToast({ title: "已复制开奖号码", icon: "none" });
      },
    });
  },

  toggleChecker() {
    this.setData({ checkerOpen: !this.data.checkerOpen });
  },

  togglePoolBall(e) {
    const { area, num } = e.currentTarget.dataset;
    const config = getCheckerConfig(this.data.game);
    const maxCount = area === "back" ? config.backCount : config.frontCount;
    const list = [...(this._selection[area] || [])];
    const idx = list.indexOf(num);
    if (idx >= 0) {
      list.splice(idx, 1);
    } else {
      if (list.length >= maxCount) {
        wx.showToast({ title: `最多选择 ${maxCount} 个号码`, icon: "none", duration: 1200 });
        return;
      }
      list.push(num);
      list.sort();
    }
    this._selection = { ...this._selection, [area]: list };
    this.setData({
      checker: buildCheckerView(this.data.game, this.data.draw, this._selection),
    });
  },

  selectPositionDigit(e) {
    const posIndex = Number(e.currentTarget.dataset.pos);
    const num = String(e.currentTarget.dataset.num);
    const positions = [...(this._selection.positions || [])];
    positions[posIndex] = positions[posIndex] === num ? "" : num;
    this._selection = { ...this._selection, positions };
    this.setData({
      checker: buildCheckerView(this.data.game, this.data.draw, this._selection),
    });
  },

  selectQxcBack(e) {
    const num = String(e.currentTarget.dataset.num);
    const current = this._selection.back && this._selection.back[0];
    this._selection = {
      ...this._selection,
      back: current === num ? [] : [num],
    };
    this.setData({
      checker: buildCheckerView(this.data.game, this.data.draw, this._selection),
    });
  },

  clearChecker() {
    const config = getCheckerConfig(this.data.game);
    this._selection = createEmptySelection(config);
    this.setData({
      checker: buildCheckerView(this.data.game, this.data.draw, this._selection),
    });
  },

  onShareAppMessage() {
    const draw = this.data.draw;
    const title = draw
      ? `${draw.name} 第${draw.issue}期开奖公告`
      : `${this.data.gameMeta.name}开奖详情`;
    return {
      title,
      path: `/packages/lottery/detail/index?game=${encodeURIComponent(this.data.game)}&issue=${encodeURIComponent(this.data.issue)}`,
    };
  },
});
