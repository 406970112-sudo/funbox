package homeconsumables

import (
	"database/sql"
	"time"
)

func nullInt64If(active bool, value int64) any {
	if !active {
		return nil
	}
	return value
}

func scanTime(value sql.NullInt64) *time.Time {
	if !value.Valid {
		return nil
	}
	parsed := time.Unix(value.Int64, 0).UTC()
	return &parsed
}

func floatPtr(value float64) *float64 {
	return &value
}

func intPtr(value int) *int {
	return &value
}
