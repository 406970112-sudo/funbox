package homeconsumables

import (
	"math"
	"sort"
	"time"
)

const (
	StatePredictable  = "predictable"
	StateDeveloping   = "developing"
	StateNoData       = "no_data"
	StateUnknownStock = "unknown_stock"
	StateStale        = "stale"
)

type CyclePoint struct {
	From     string  `json:"from"`
	To       string  `json:"to"`
	Days     int     `json:"days"`
	Quantity float64 `json:"quantity"`
}

type Prediction struct {
	State         string       `json:"state"`
	RemainingDays *int         `json:"remainingDays,omitempty"`
	AvgCycleDays  *float64     `json:"avgCycleDays,omitempty"`
	RatePerDay    *float64     `json:"ratePerDay,omitempty"`
	SampleCount   int          `json:"sampleCount"`
	Cycles        []CyclePoint `json:"cycles"`
}

type usagePoint struct {
	at       time.Time
	quantity float64
}

func computePrediction(currentStock *float64, events []Event, currentCycleStartedAt *time.Time, now time.Time) Prediction {
	points := []usagePoint{}
	for _, event := range events {
		if event.UndoneAt != nil {
			continue
		}
		if event.EventType != EventTypeReplace && event.EventType != EventTypeConsume {
			continue
		}
		points = append(points, usagePoint{at: event.OccurredAt.UTC(), quantity: event.Quantity})
	}
	sort.Slice(points, func(i, j int) bool {
		return points[i].at.Before(points[j].at)
	})
	if currentCycleStartedAt != nil && !currentCycleStartedAt.IsZero() &&
		(len(points) == 0 || currentCycleStartedAt.UTC().Before(points[0].at)) {
		points = append([]usagePoint{{at: currentCycleStartedAt.UTC(), quantity: 0}}, points...)
	}

	cycles := []CyclePoint{}
	for index := 1; index < len(points); index++ {
		days := points[index].at.Sub(points[index-1].at).Hours() / 24
		if days <= 0 {
			continue
		}
		cycles = append(cycles, CyclePoint{
			From:     points[index-1].at.Format("2006-01-02"),
			To:       points[index].at.Format("2006-01-02"),
			Days:     int(math.Round(days)),
			Quantity: points[index].quantity,
		})
	}
	if len(cycles) > 3 {
		cycles = cycles[len(cycles)-3:]
	}

	prediction := Prediction{
		State:       StateNoData,
		SampleCount: len(cycles),
		Cycles:      cycles,
	}
	if len(cycles) == 0 {
		if currentStock == nil {
			prediction.State = StateUnknownStock
		}
		return prediction
	}

	totalDays := 0.0
	totalQuantity := 0.0
	lastEventAt := points[len(points)-1].at
	for _, cycle := range cycles {
		totalDays += float64(cycle.Days)
		totalQuantity += cycle.Quantity
	}
	avgDays := totalDays / float64(len(cycles))
	ratePerDay := totalQuantity / totalDays
	prediction.AvgCycleDays = &avgDays
	prediction.RatePerDay = &ratePerDay

	if currentStock == nil {
		prediction.State = StateUnknownStock
		return prediction
	}
	if now.Sub(lastEventAt) > 180*24*time.Hour {
		prediction.State = StateStale
	}
	if ratePerDay > 0 {
		remaining := int(math.Ceil(*currentStock / ratePerDay))
		if remaining < 1 && *currentStock > 0 {
			remaining = 1
		}
		prediction.RemainingDays = &remaining
	}
	if prediction.State == StateStale {
		return prediction
	}
	if len(cycles) >= 3 {
		prediction.State = StatePredictable
	} else {
		prediction.State = StateDeveloping
	}
	return prediction
}
