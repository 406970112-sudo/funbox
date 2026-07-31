package score

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
)

type settlementBalance struct {
	amount int64
	id     string
}

type settlementResult struct {
	plan []Transfer
	ok   bool
}

func MinimumTransfers(balances map[string]int64, order []string) ([]Transfer, error) {
	var total int64
	for _, amount := range balances {
		total += amount
	}
	if total != 0 {
		return nil, ErrBalancesNotZero
	}

	orderIndex := make(map[string]int, len(order))
	for index, id := range order {
		if _, exists := orderIndex[id]; !exists {
			orderIndex[id] = index
		}
	}
	records := make([]settlementBalance, 0, len(balances))
	for id, amount := range balances {
		if amount != 0 {
			records = append(records, settlementBalance{id: id, amount: amount})
		}
	}
	sort.Slice(records, func(i, j int) bool {
		left, leftOK := orderIndex[records[i].id]
		right, rightOK := orderIndex[records[j].id]
		switch {
		case leftOK && rightOK && left != right:
			return left < right
		case leftOK != rightOK:
			return leftOK
		default:
			return records[i].id < records[j].id
		}
	})
	if len(records) == 0 {
		return []Transfer{}, nil
	}

	memo := make(map[string]settlementResult)
	result := solveMinimumTransfers(records, memo)
	if !result.ok {
		return nil, fmt.Errorf("find minimum transfers: %w", ErrBalancesNotZero)
	}
	return append([]Transfer(nil), result.plan...), nil
}

func solveMinimumTransfers(records []settlementBalance, memo map[string]settlementResult) settlementResult {
	first := -1
	for index := range records {
		if records[index].amount != 0 {
			first = index
			break
		}
	}
	if first == -1 {
		return settlementResult{plan: []Transfer{}, ok: true}
	}

	key := settlementStateKey(records)
	if cached, exists := memo[key]; exists {
		return settlementResult{plan: append([]Transfer(nil), cached.plan...), ok: cached.ok}
	}

	best := settlementResult{}
	seenCandidateAmounts := make(map[int64]struct{})
	for candidate := first + 1; candidate < len(records); candidate++ {
		if records[candidate].amount == 0 || (records[first].amount < 0) == (records[candidate].amount < 0) {
			continue
		}
		if _, duplicate := seenCandidateAmounts[records[candidate].amount]; duplicate {
			continue
		}
		seenCandidateAmounts[records[candidate].amount] = struct{}{}

		next := append([]settlementBalance(nil), records...)
		amount := min64(abs64(next[first].amount), abs64(next[candidate].amount))
		var transfer Transfer
		if next[first].amount < 0 {
			transfer = Transfer{
				FromParticipantID: next[first].id,
				ToParticipantID:   next[candidate].id,
				AmountCents:       amount,
			}
			next[first].amount += amount
			next[candidate].amount -= amount
		} else {
			transfer = Transfer{
				FromParticipantID: next[candidate].id,
				ToParticipantID:   next[first].id,
				AmountCents:       amount,
			}
			next[first].amount -= amount
			next[candidate].amount += amount
		}

		tail := solveMinimumTransfers(next, memo)
		if !tail.ok {
			continue
		}
		plan := make([]Transfer, 0, len(tail.plan)+1)
		plan = append(plan, transfer)
		plan = append(plan, tail.plan...)
		if !best.ok || len(plan) < len(best.plan) || (len(plan) == len(best.plan) && transferPlanKey(plan) < transferPlanKey(best.plan)) {
			best = settlementResult{plan: plan, ok: true}
		}
	}

	memo[key] = settlementResult{plan: append([]Transfer(nil), best.plan...), ok: best.ok}
	return best
}

func settlementStateKey(records []settlementBalance) string {
	var builder strings.Builder
	for _, record := range records {
		builder.WriteString(strconv.FormatInt(record.amount, 10))
		builder.WriteByte(',')
	}
	return builder.String()
}

func transferPlanKey(transfers []Transfer) string {
	var builder strings.Builder
	for _, transfer := range transfers {
		builder.WriteString(transfer.FromParticipantID)
		builder.WriteByte('>')
		builder.WriteString(transfer.ToParticipantID)
		builder.WriteByte(':')
		builder.WriteString(strconv.FormatInt(transfer.AmountCents, 10))
		builder.WriteByte(';')
	}
	return builder.String()
}

func abs64(value int64) int64 {
	if value < 0 {
		return -value
	}
	return value
}

func min64(left int64, right int64) int64 {
	if left < right {
		return left
	}
	return right
}
