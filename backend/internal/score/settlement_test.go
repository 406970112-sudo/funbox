package score

import (
	"errors"
	"fmt"
	"reflect"
	"sort"
	"strings"
	"testing"
)

func TestMinimumTransfersSettlesBalancesWithFewestTransactions(t *testing.T) {
	tests := []struct {
		name     string
		balances map[string]int64
		order    []string
		wantLen  int
	}{
		{
			name:     "one creditor and two debtors",
			balances: map[string]int64{"a": 1000, "b": -500, "c": -500},
			order:    []string{"a", "b", "c"},
			wantLen:  2,
		},
		{
			name:     "two exact pairs",
			balances: map[string]int64{"a": 500, "b": -500, "c": 500, "d": -500},
			order:    []string{"a", "b", "c", "d"},
			wantLen:  2,
		},
		{
			name:     "zero balances are ignored",
			balances: map[string]int64{"a": 0, "b": 700, "c": -700},
			order:    []string{"a", "b", "c"},
			wantLen:  1,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := MinimumTransfers(test.balances, test.order)
			if err != nil {
				t.Fatalf("MinimumTransfers() error = %v", err)
			}
			if len(got) != test.wantLen {
				t.Fatalf("MinimumTransfers() returned %d transfers, want %d: %+v", len(got), test.wantLen, got)
			}
			assertTransfersSettle(t, test.balances, got)
		})
	}
}

func TestMinimumTransfersIsDeterministic(t *testing.T) {
	balances := map[string]int64{"alice": 500, "bob": 500, "chen": -500, "dai": -500}
	order := []string{"alice", "bob", "chen", "dai"}

	first, err := MinimumTransfers(balances, order)
	if err != nil {
		t.Fatal(err)
	}
	for iteration := 0; iteration < 20; iteration++ {
		got, runErr := MinimumTransfers(balances, order)
		if runErr != nil {
			t.Fatal(runErr)
		}
		if !reflect.DeepEqual(got, first) {
			t.Fatalf("run %d = %+v, first = %+v", iteration, got, first)
		}
	}
}

func TestMinimumTransfersRejectsUnbalancedInput(t *testing.T) {
	_, err := MinimumTransfers(map[string]int64{"a": 100, "b": -99}, []string{"a", "b"})
	if !errors.Is(err, ErrBalancesNotZero) {
		t.Fatalf("MinimumTransfers() error = %v, want ErrBalancesNotZero", err)
	}
}

func TestMinimumTransfersMatchesIndependentOptimalCount(t *testing.T) {
	for participantCount := 2; participantCount <= 6; participantCount++ {
		ids := make([]string, participantCount)
		for index := range ids {
			ids[index] = fmt.Sprintf("p%d", index)
		}
		enumerateSmallBalances(participantCount, func(values []int64) {
			var sum int64
			balances := make(map[string]int64, participantCount)
			for index, value := range values {
				sum += value
				balances[ids[index]] = value
			}
			if sum != 0 {
				return
			}

			got, err := MinimumTransfers(balances, ids)
			if err != nil {
				t.Fatalf("values=%v error=%v", values, err)
			}
			want := independentMinimumCount(values)
			if len(got) != want {
				t.Fatalf("values=%v transfers=%+v count=%d want=%d", values, got, len(got), want)
			}
			assertTransfersSettle(t, balances, got)
		})
	}
}

func TestMinimumTransfersHandlesLargeOppositeBalances(t *testing.T) {
	amount := int64(2_147_483_648) * 1_000_000
	transfers, err := MinimumTransfers(
		map[string]int64{"winner": amount, "loser": -amount},
		[]string{"winner", "loser"},
	)
	if err != nil {
		t.Fatalf("MinimumTransfers returned error for valid large balances: %v", err)
	}
	if len(transfers) != 1 {
		t.Fatalf("expected one transfer, got %+v", transfers)
	}
	if transfers[0].FromParticipantID != "loser" || transfers[0].ToParticipantID != "winner" || transfers[0].AmountCents != amount {
		t.Fatalf("unexpected large-balance transfer: %+v", transfers[0])
	}
}

func assertTransfersSettle(t *testing.T, balances map[string]int64, transfers []Transfer) {
	t.Helper()
	remaining := make(map[string]int64, len(balances))
	for id, amount := range balances {
		remaining[id] = amount
	}
	for _, transfer := range transfers {
		if transfer.AmountCents <= 0 {
			t.Fatalf("transfer amount must be positive: %+v", transfer)
		}
		if _, ok := remaining[transfer.FromParticipantID]; !ok {
			t.Fatalf("unknown payer: %+v", transfer)
		}
		if _, ok := remaining[transfer.ToParticipantID]; !ok {
			t.Fatalf("unknown receiver: %+v", transfer)
		}
		remaining[transfer.FromParticipantID] += transfer.AmountCents
		remaining[transfer.ToParticipantID] -= transfer.AmountCents
	}
	for id, amount := range remaining {
		if amount != 0 {
			t.Fatalf("participant %s remains at %d after %+v", id, amount, transfers)
		}
	}
}

func enumerateSmallBalances(count int, visit func([]int64)) {
	values := make([]int64, count)
	var walk func(int)
	walk = func(index int) {
		if index == len(values) {
			copyOfValues := append([]int64(nil), values...)
			visit(copyOfValues)
			return
		}
		for value := int64(-2); value <= 2; value++ {
			values[index] = value
			walk(index + 1)
		}
	}
	walk(0)
}

func independentMinimumCount(values []int64) int {
	balances := make([]int64, 0, len(values))
	for _, value := range values {
		if value != 0 {
			balances = append(balances, value)
		}
	}
	if len(balances) == 0 {
		return 0
	}
	memo := make(map[string]int)
	var solve func([]int64) int
	solve = func(current []int64) int {
		filtered := current[:0]
		for _, value := range current {
			if value != 0 {
				filtered = append(filtered, value)
			}
		}
		current = filtered
		if len(current) == 0 {
			return 0
		}
		normalized := append([]int64(nil), current...)
		sort.Slice(normalized, func(i, j int) bool { return normalized[i] < normalized[j] })
		parts := make([]string, len(normalized))
		for index, value := range normalized {
			parts[index] = fmt.Sprintf("%d", value)
		}
		key := strings.Join(parts, ",")
		if cached, ok := memo[key]; ok {
			return cached
		}

		best := len(current) - 1
		first := current[0]
		for index := 1; index < len(current); index++ {
			if first*current[index] >= 0 {
				continue
			}
			next := append([]int64(nil), current[1:]...)
			next[index-1] += first
			candidate := 1 + solve(next)
			if candidate < best {
				best = candidate
			}
		}
		memo[key] = best
		return best
	}
	return solve(append([]int64(nil), balances...))
}
