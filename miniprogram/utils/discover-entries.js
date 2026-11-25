const { getHolidayCard, watchHolidayCalendar } = require("./holiday-calendar");

const paths = {
  all: "/packages/discover/index/index",
  notebook: "/packages/notebook/index/index",
  memes: "/packages/meme/library/index",
  holidays: "/packages/discover/holidays/index",
};

function discoverPath(entry, loggedIn = false) {
  const path = paths[entry];
  return entry === "notebook" && !loggedIn
    ? `/pages/auth/index?mode=login&returnTo=${encodeURIComponent(path)}`
    : path;
}

function watchHolidayCard(page) {
  return watchHolidayCalendar(({ calendar, now }) => {
    page.setData({ holidayCard: getHolidayCard(calendar, now) });
  });
}

module.exports = { discoverPath, watchHolidayCard };
