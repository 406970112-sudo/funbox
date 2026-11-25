const test = require("node:test");
const assert = require("node:assert/strict");

const calendarModule = "../utils/holiday-calendar";
const holiday = (id, name, startDate, endDate, makeupDates = []) => ({ id, name, startDate, endDate, makeupDates });
const calendar = {
  version: "2026-11-05.1",
  years: [
    {
      year: 2026,
      source: { title: "2026 年放假安排", publishedAt: "2025-11-04", url: "https://www.beijing.gov.cn/2026" },
      holidays: [holiday("national-day", "国庆节", "2026-10-01", "2026-10-07", ["2026-09-20", "2026-10-10"])],
    },
    {
      year: 2027,
      source: { title: "2027 年放假安排", publishedAt: "2026-11-05", url: "https://www.dxh.gov.cn/2027" },
      holidays: [
        holiday("new-year", "元旦", "2027-01-01", "2027-01-03"),
        holiday("spring-festival", "春节", "2027-02-05", "2027-02-13", ["2027-01-31", "2027-02-14"]),
        holiday("qingming", "清明节", "2027-04-03", "2027-04-05"),
        holiday("dragon-boat", "端午节", "2027-06-09", "2027-06-09"),
      ],
    },
  ],
};

function view(at, year) {
  return require(calendarModule).getHolidayView(calendar, Date.parse(at), year);
}

test("November shows the next confirmed holiday across calendar years", () => {
  const result = view("2026-11-25T12:00:00+08:00");
  assert.equal(result.upcoming.name, "元旦");
  assert.equal(result.upcoming.daysUntil, 37);
  assert.equal(result.upcoming.duration, 3);
  assert.equal(result.selectedYear, 2027);
  assert.deepEqual(result.years, [2027, 2026]);
});

test("holiday days roll at Beijing midnight and count both endpoints", () => {
  assert.equal(view("2026-12-31T15:59:59Z").upcoming.state, "tomorrow");
  const start = view("2026-12-31T16:00:00Z").upcoming;
  assert.equal(start.state, "holiday");
  assert.equal(start.dayNumber, 1);
  assert.equal(view("2027-01-03T15:59:59Z").upcoming.dayNumber, 3);
  assert.equal(view("2027-01-03T16:00:00Z").upcoming.name, "春节");
  assert.equal(view("2027-06-09T00:00:00+08:00").upcoming.duration, 1);
});

test("a makeup day keeps the next holiday and stays attached to its own period", () => {
  const before = view("2027-01-31T12:00:00+08:00");
  assert.equal(before.isMakeupDay, true);
  assert.equal(before.upcoming.name, "春节");
  assert.equal(before.upcoming.daysUntil, 5);
  assert.equal(before.upcoming.duration, 9);
  assert.equal(before.holidays[1].makeupLabel, "1 月 31 日、2 月 14 日");
  const after = view("2027-02-14T12:00:00+08:00");
  assert.equal(after.isMakeupDay, true);
  assert.equal(after.upcoming.name, "清明节");
});

test("history remains available without an invented upcoming date", () => {
  const result = view("2027-06-10T00:00:00+08:00", 2026);
  assert.equal(result.upcoming, null);
  assert.equal(result.selectedYear, 2026);
  assert.equal(result.holidays[0].past, true);
  assert.equal(result.source.publishedAt, "2025-11-04");
});

test("switching to another published year highlights that year's next holiday", () => {
  const result = view("2026-09-25T12:00:00+08:00", 2027);
  assert.equal(result.upcoming.name, "国庆节");
  assert.equal(result.highlight.name, "元旦");
  assert.equal(result.highlight.daysUntil, 98);
  assert.equal(result.holidays[0].current, true);
});

const flush = () => new Promise(resolve => setImmediate(resolve));

function mountCalendar(t, saved) {
  const modulePath = require.resolve(calendarModule);
  const previousWx = global.wx;
  const requests = [];
  const writes = [];
  global.wx = {
    getStorageSync: () => saved,
    setStorageSync: (key, value) => { saved = value; writes.push(value); },
    request: options => requests.push(options),
  };
  delete require.cache[modulePath];
  const { watchHolidayCalendar } = require(calendarModule);
  const stops = [];
  t.after(() => {
    stops.forEach(stop => stop());
    delete require.cache[modulePath];
    global.wx = previousWx;
  });
  return {
    requests,
    writes,
    mount(updates) {
      const stop = watchHolidayCalendar(update => updates.push(update));
      stops.push(stop);
      return stop;
    },
  };
}

test("first offline load shows a retry state and reopening can recover", async t => {
  const app = mountCalendar(t);
  const updates = [];
  const stop = app.mount(updates);
  assert.equal(updates[0].status, "loading");
  assert.match(app.requests[0].url, /\/api\/v1\/holiday-calendar$/);
  assert.equal(app.requests[0].header.Authorization, undefined);
  app.requests[0].fail({ errMsg: "offline" });
  await flush();
  assert.equal(updates.at(-1).status, "error");
  stop();
  app.mount(updates);
  app.requests[1].success({ statusCode: 200, data: calendar });
  await flush();
  assert.equal(updates.at(-1).status, "ready");
  assert.equal(app.writes[0].version, calendar.version);
});

test("a malformed refresh does not replace cached dates or update hidden pages", async t => {
  const app = mountCalendar(t, calendar);
  const hiddenUpdates = [], activeUpdates = [];
  const stop = app.mount(hiddenUpdates);
  stop();
  app.mount(activeUpdates);
  assert.equal(app.requests.length, 1);
  assert.equal(activeUpdates[0].status, "ready");
  const malformed = structuredClone(calendar);
  malformed.years[1].holidays[1].startDate = "2027-02-31";
  app.requests[0].success({ statusCode: 200, data: malformed });
  await flush();
  assert.equal(hiddenUpdates.length, 1);
  assert.equal(activeUpdates.at(-1).calendar.years[1].holidays[1].startDate, "2027-02-05");
  assert.equal(app.writes.length, 0);
});

test("a visible calendar updates at Beijing midnight and cancels its next update on exit", t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: Date.parse("2026-12-31T15:59:59.999Z") });
  const app = mountCalendar(t, calendar);
  const updates = [];
  const stop = app.mount(updates);
  const { getHolidayView } = require(calendarModule);
  const state = update => getHolidayView(update.calendar, update.now).upcoming.state;
  assert.equal(state(updates[0]), "tomorrow");
  t.mock.timers.tick(1);
  assert.equal(updates.length, 2);
  assert.equal(state(updates[1]), "holiday");
  stop();
  t.mock.timers.tick(24 * 60 * 60 * 1000);
  assert.equal(updates.length, 2);
});
