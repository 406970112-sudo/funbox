package score

import (
	"fmt"
	"reflect"
	"testing"
)

func TestSettlementTransfersHandlesLargeZeroSumGroups(t *testing.T) {
	balances := make(map[string]int64)
	order := make([]string, 0, 200)
	var sum int64
	for i := 0; i < 199; i++ {
		id := fmt.Sprintf("member-%03d", i)
		amount := int64(i*137%997 + 1)
		if i%2 == 0 {
			amount = -amount
		}
		balances[id] = amount
		order = append(order, id)
		sum += amount
	}
	balances["last"] = -sum
	order = append(order, "last")
	transfers, err := SettlementTransfers(balances, order)
	if err != nil {
		t.Fatal(err)
	}
	remaining := make(map[string]int64)
	for id, amount := range balances {
		remaining[id] = amount
	}
	for _, transfer := range transfers {
		if transfer.AmountCents <= 0 || balances[transfer.FromParticipantID] >= 0 || balances[transfer.ToParticipantID] <= 0 {
			t.Fatalf("invalid transfer: %+v", transfer)
		}
		remaining[transfer.FromParticipantID] += transfer.AmountCents
		remaining[transfer.ToParticipantID] -= transfer.AmountCents
	}
	for id, amount := range remaining {
		if amount != 0 {
			t.Fatalf("unsettled %s: %d", id, amount)
		}
	}
	if len(transfers) > 199 {
		t.Fatalf("too many transfers: %d", len(transfers))
	}
	again, err := SettlementTransfers(balances, order)
	if err != nil || !reflect.DeepEqual(transfers, again) {
		t.Fatalf("unstable plan: %v", err)
	}
}

func TestSettlementTransfersKeepsExactSmallPlans(t *testing.T) {
	balances := map[string]int64{"a": -7, "b": -5, "c": 5, "d": 7}
	order := []string{"a", "b", "c", "d"}
	got, err := SettlementTransfers(balances, order)
	if err != nil || len(got) != 2 {
		t.Fatalf("small plan: %+v %v", got, err)
	}
	if _, err := SettlementTransfers(map[string]int64{"a": 1}, nil); err != ErrBalancesNotZero {
		t.Fatalf("invalid balance error: %v", err)
	}
}
