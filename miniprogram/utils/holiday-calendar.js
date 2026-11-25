const { request } = require("./request");

const DAY = 24 * 60 * 60 * 1000;
const BEIJING_OFFSET = 8 * 60 * 60 * 1000;
const CACHE_KEY = "funbox.holiday-calendar.v1";

let latestCalendar;
let inflight;

function dayIndex(date) {
  return Date.parse(`${date}T00:00:00Z`) / DAY;
}

function isDate(date) {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const day = dayIndex(date);
  return Number.isInteger(day) && new Date(day * DAY).toISOString().slice(0, 10) === date;
}

function isHoliday(holiday) {
  return holiday && typeof holiday.id === "string" && holiday.id && typeof holiday.name === "string" && holiday.name &&
    isDate(holiday.startDate) && isDate(holiday.endDate) && holiday.startDate <= holiday.endDate &&
    Array.isArray(holiday.makeupDates) && holiday.makeupDates.every(isDate);
}

function isCalendar(calendar) {
  return calendar && typeof calendar.version === "string" && calendar.version && Array.isArray(calendar.years) &&
    calendar.years.length > 0 && calendar.years.every(entry => entry && Number.isInteger(entry.year) &&
      entry.source && typeof entry.source.title === "string" && isDate(entry.source.publishedAt) &&
      typeof entry.source.url === "string" && /^https:\/\/[^/]+\//.test(entry.source.url) &&
      Array.isArray(entry.holidays) && entry.holidays.length > 0 && entry.holidays.every(isHoliday));
}

function readCalendar() {
  if (latestCalendar) return latestCalendar;
  try {
    const saved = wx.getStorageSync(CACHE_KEY);
    if (isCalendar(saved)) latestCalendar = saved;
  } catch (error) {
    // The public calendar remains usable when local storage is unavailable.
  }
  return latestCalendar || null;
}

function refreshCalendar() {
  if (!inflight) {
    inflight = request({ path: "/holiday-calendar" }).then(calendar => {
      if (!isCalendar(calendar)) throw new Error("Invalid holiday calendar");
      latestCalendar = calendar;
      try { wx.setStorageSync(CACHE_KEY, calendar); } catch (error) { /* Keep the in-memory copy. */ }
      return calendar;
    }).finally(() => { inflight = null; });
  }
  return inflight;
}

function watchHolidayCalendar(update) {
  let calendar = readCalendar();
  let status = calendar ? "ready" : "loading";
  let active = true;
  let timer;

  function publish() {
    const now = Date.now();
    update({ calendar, status, now });
    clearTimeout(timer);
    if (active) timer = setTimeout(publish, DAY - (now + BEIJING_OFFSET) % DAY);
  }

  publish();
  refreshCalendar().then(result => {
    if (!active) return;
    calendar = result;
    status = "ready";
    publish();
  }, () => {
    if (!active || calendar) return;
    status = "error";
    publish();
  });

  return () => {
    active = false;
    clearTimeout(timer);
  };
}

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const SHORT_WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

function weekdayLabel(date) {
  return WEEKDAYS[new Date(dayIndex(date) * DAY).getUTCDay()];
}

function shortWeekdayLabel(date) {
  return SHORT_WEEKDAYS[new Date(dayIndex(date) * DAY).getUTCDay()];
}

function holidayTheme(id) {
  if (id === "spring-festival" || id === "national-day") return "coral";
  if (id === "qingming" || id === "dragon-boat") return "mint";
  if (id === "mid-autumn") return "amber";
  return "blue";
}

function buildHolidayDays(holiday, today) {
  const days = [];
  const startIdx = dayIndex(holiday.startDate);
  const endIdx = dayIndex(holiday.endDate);
  for (let idx = startIdx; idx <= endIdx; idx += 1) {
    const iso = new Date(idx * DAY).toISOString().slice(0, 10);
    const [, m, d] = iso.split("-").map(Number);
    days.push({
      date: iso,
      monthDay: `${m}.${d}`,
      dayNum: String(d),
      weekday: shortWeekdayLabel(iso),
      kind: "rest",
      badge: "休",
      isToday: idx === today,
    });
  }
  holiday.makeupDates.forEach(iso => {
    const idx = dayIndex(iso);
    const [, m, d] = iso.split("-").map(Number);
    days.push({
      date: iso,
      monthDay: `${m}.${d}`,
      dayNum: String(d),
      weekday: shortWeekdayLabel(iso),
      kind: "makeup",
      badge: "班",
      isToday: idx === today,
    });
  });
  return days.sort((a, b) => a.date.localeCompare(b.date));
}

function computeWeekendInfo(today, isMakeupDay, inHoliday) {
  if (inHoliday) return { label: "假期愉快", tone: "holiday" };
  if (isMakeupDay) return { label: "今天调休上班", tone: "makeup" };
  const weekday = new Date(today * DAY).getUTCDay();
  if (weekday === 0 || weekday === 6) return { label: "周末愉快", tone: "weekend" };
  if (weekday === 5) return { label: "明天就是周末", tone: "near" };
  return { label: `距周末 ${6 - weekday} 天`, tone: "workday" };
}

function formatDay(date, compact = false) {
  const [, month, day] = date.split("-").map(Number);
  return compact ? `${month}.${day}` : `${month} 月 ${day} 日`;
}

function formatPeriod(start, end, compact = false) {
  const first = formatDay(start, compact);
  if (start === end) return first;
  if (compact) return `${first}–${formatDay(end, true)}`;
  const last = start.slice(0, 7) === end.slice(0, 7) ? `${Number(end.slice(8))} 日` : formatDay(end);
  return `${first}–${last}`;
}

function formatWeekdayRange(start, end) {
  const first = weekdayLabel(start);
  if (start === end) return first;
  return `${first}至${weekdayLabel(end)}`;
}

function holidayRow(holiday, today) {
  const startIdx = dayIndex(holiday.startDate);
  const endIdx = dayIndex(holiday.endDate);
  const duration = endIdx - startIdx + 1;
  const past = endIdx < today;
  const inProgress = startIdx <= today && endIdx >= today;
  const daysUntil = Math.max(startIdx - today, 0);
  const dayNumber = inProgress ? today - startIdx + 1 : 0;
  const [, startMonth, startDay] = holiday.startDate.split("-").map(Number);
  const dateLabel = formatPeriod(holiday.startDate, holiday.endDate);
  const makeupDetailLabel = holiday.makeupDates.map(date => `${formatDay(date)}(${weekdayLabel(date)})`).join("、");
  const statusText = past
    ? "已结束"
    : inProgress
      ? (duration > 1 ? `第 ${dayNumber} 天` : "今天放假")
      : daysUntil === 1
        ? "明天放假"
        : `${daysUntil} 天后`;
  const copySummary = `${holiday.year ? `${holiday.year} 年` : ""}${holiday.name}：${dateLabel}（共 ${duration} 天），${holiday.makeupDates.length ? `调休上班：${makeupDetailLabel}` : "无需调休"}`;

  return {
    ...holiday,
    duration,
    theme: holidayTheme(holiday.id),
    dateLabel,
    weekdayRange: formatWeekdayRange(holiday.startDate, holiday.endDate),
    monthBadge: `${startMonth}月`,
    dayBadge: String(startDay).padStart(2, "0"),
    makeupLabel: holiday.makeupDates.map(date => formatDay(date)).join("、"),
    makeupDetailLabel,
    makeupCount: holiday.makeupDates.length,
    hasMakeup: holiday.makeupDates.length > 0,
    days: buildHolidayDays(holiday, today),
    past,
    inProgress,
    daysUntil,
    dayNumber,
    progressPercent: inProgress ? Math.round((dayNumber / duration) * 100) : 0,
    statusText,
    copySummary,
  };
}

function upcomingHoliday(holiday, today) {
  if (!holiday) return null;
  const row = holidayRow(holiday, today);
  const diff = dayIndex(holiday.startDate) - today;
  return {
    ...row,
    state: diff <= 0 ? "holiday" : diff === 1 ? "tomorrow" : diff <= 7 ? "near" : "upcoming",
    daysUntil: Math.max(diff, 0),
    dayNumber: diff <= 0 ? 1 - diff : 0,
  };
}

function getHolidayView(calendar, now = Date.now(), year) {
  const today = Math.floor((now + BEIJING_OFFSET) / DAY);
  const date = new Date(today * DAY).toISOString().slice(0, 10);
  const years = calendar.years.map(entry => entry.year).sort((a, b) => b - a);
  const holidays = calendar.years.flatMap(entry => entry.holidays.map(holiday => ({ ...holiday, year: entry.year })))
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const next = holidays.find(holiday => holiday.endDate >= date);
  const upcoming = upcomingHoliday(next, today);
  const selectedYear = years.includes(year) ? year : upcoming ? upcoming.year : years[0];
  const { source } = calendar.years.find(entry => entry.year === selectedYear);
  const yearHolidays = holidays.filter(holiday => holiday.year === selectedYear);
  const nextInYear = yearHolidays.find(holiday => holiday.endDate >= date);
  const decoratedHolidays = yearHolidays.map(holiday => ({
    ...holidayRow(holiday, today),
    current: holiday === nextInYear,
  }));

  const isMakeupDay = holidays.some(holiday => holiday.makeupDates.includes(date));
  const totalDays = decoratedHolidays.reduce((sum, item) => sum + item.duration, 0);
  const remainingHolidays = decoratedHolidays.filter(item => !item.past);
  const remainingDays = remainingHolidays.reduce((sum, item) => (
    sum + (item.inProgress ? item.duration - item.dayNumber + 1 : item.duration)
  ), 0);
  const makeupCount = decoratedHolidays.reduce((sum, item) => sum + item.makeupDates.length, 0);
  const cleanCount = decoratedHolidays.filter(item => !item.hasMakeup).length;
  const withMakeupCount = decoratedHolidays.length - cleanCount;
  const [todayYear] = date.split("-").map(Number);

  return {
    years,
    selectedYear,
    source,
    upcoming,
    highlight: nextInYear === next ? upcoming : upcomingHoliday(nextInYear, today),
    isMakeupDay,
    todayLabel: `${formatDay(date)} · ${weekdayLabel(date)}`,
    todayFullLabel: `${todayYear} 年 ${formatDay(date)} · ${weekdayLabel(date)}`,
    weekend: computeWeekendInfo(today, isMakeupDay, Boolean(upcoming && upcoming.state === "holiday")),
    yearStats: {
      totalCount: decoratedHolidays.length,
      totalDays,
      remainingCount: remainingHolidays.length,
      remainingDays,
      makeupCount,
      cleanCount,
      withMakeupCount,
    },
    holidays: decoratedHolidays,
  };
}

function getHolidayCard(calendar, now) {
  if (!calendar) return null;
  const { upcoming, isMakeupDay } = getHolidayView(calendar, now);
  if (!upcoming) return { label: "放假安排待公布", isMakeupDay };

  const { name, year, state, duration, startDate, endDate, dayNumber, daysUntil, monthBadge, dayBadge, hasMakeup, makeupCount } = upcoming;
  const period = formatPeriod(startDate, endDate, true);
  let label = `距${name}放假`;
  if (state === "tomorrow") label = `明天${name}放假`;
  if (state === "holiday") label = duration === 1 ? `今天${name}放假` : `${name}假期`;
  return {
    name,
    year,
    duration,
    label,
    state,
    count: state === "holiday" ? (duration > 1 ? dayNumber : 0) : daysUntil,
    dateLabel: `${period} · ${duration} 天`,
    monthBadge,
    dayBadge,
    hasMakeup,
    makeupCount,
    isMakeupDay,
  };
}

module.exports = { watchHolidayCalendar, getHolidayView, getHolidayCard };
