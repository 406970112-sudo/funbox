package homeconsumables

import (
	"testing"
	"time"
)

func TestComputePredictionUsesLastThreeCycles(t *testing.T) {
	currentStock := 0.5
	startedAt := time.Date(2026, 4, 25, 0, 0, 0, 0, time.UTC)
	events := []Event{
		{EventType: EventTypeReplace, Quantity: 1, OccurredAt: time.Date(2026, 5, 9, 0, 0, 0, 0, time.UTC)},
		{EventType: EventTypeReplace, Quantity: 1, OccurredAt: time.Date(2026, 5, 21, 0, 0, 0, 0, time.UTC)},
		{EventType: EventTypeReplace, Quantity: 1, OccurredAt: time.Date(2026, 5, 31, 0, 0, 0, 0, time.UTC)},
	}
	now := time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC)
	prediction := computePrediction(&currentStock, events, &startedAt, now)
	if prediction.State != StatePredictable {
		t.Fatalf("state = %s", prediction.State)
	}
	if prediction.SampleCount != 3 {
		t.Fatalf("sample count = %d", prediction.SampleCount)
	}
	if prediction.RemainingDays == nil || *prediction.RemainingDays != 6 {
		t.Fatalf("remaining days = %+v", prediction.RemainingDays)
	}
	if prediction.AvgCycleDays == nil || *prediction.AvgCycleDays != 12 {
		t.Fatalf("avg cycle days = %+v", prediction.AvgCycleDays)
	}
}

func TestComputePredictionRequiresRealCycles(t *testing.T) {
	currentStock := 1.0
	prediction := computePrediction(&currentStock, nil, nil, time.Now())
	if prediction.State != StateNoData {
		t.Fatalf("state = %s", prediction.State)
	}
	if prediction.RemainingDays != nil {
		t.Fatalf("remaining days should be nil")
	}
}

func TestComputePredictionHonoursUnknownStock(t *testing.T) {
	startedAt := time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)
	events := []Event{
		{EventType: EventTypeReplace, Quantity: 1, OccurredAt: time.Date(2026, 5, 20, 0, 0, 0, 0, time.UTC)},
		{EventType: EventTypeReplace, Quantity: 1, OccurredAt: time.Date(2026, 6, 3, 0, 0, 0, 0, time.UTC)},
	}
	prediction := computePrediction(nil, events, &startedAt, time.Now())
	if prediction.State != StateUnknownStock {
		t.Fatalf("state = %s", prediction.State)
	}
	if prediction.RemainingDays != nil {
		t.Fatalf("remaining days should be nil")
	}
}
