package httpapi

import (
	_ "embed"
	"net/http"
)

//go:embed holiday_calendar.json
var holidayCalendarJSON []byte

func handleHolidayCalendar(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=300")
	_, _ = w.Write(holidayCalendarJSON)
}
