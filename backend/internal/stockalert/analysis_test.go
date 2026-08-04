package stockalert

import (
	"strings"
	"testing"
)

func TestRuleSystemPromptRequiresStructuredReferenceZones(t *testing.T) {
	prompt := buildRuleSystemPrompt()
	for _, required := range []string{
		"referenceZone (object containing low (number) and high (number))",
		"Never encode referenceZone as text",
		"Never omit a required field",
	} {
		if !strings.Contains(prompt, required) {
			t.Fatalf("prompt missing %q", required)
		}
	}
}

func TestParseRuleAcceptsNumericStrings(t *testing.T) {
	raw := `{
		"buySignal": {
			"triggerPrice": "100.5",
			"conditions": ["price above trigger"],
			"referenceZone": {"low": "99", "high": "101"}
		},
		"sellSignal": {
			"triggerPrice": "108",
			"conditions": ["price reaches target"],
			"referenceZone": {"low": "107", "high": "109"}
		},
		"stopLoss": {"triggerPrice": "94", "condition": "price below stop"},
		"validTradingDays": "5",
		"reasons": ["trend remains constructive"],
		"summary": "Wait for confirmation."
	}`

	rule, err := parseRule(raw, Features{})
	if err != nil {
		t.Fatal(err)
	}
	if rule.BuyTrigger != 100.5 || rule.SellTrigger != 108 || rule.StopLoss != 94 {
		t.Fatalf("unexpected prices: %#v", rule)
	}
	if rule.BuyReferenceLow != 99 || rule.BuyReferenceHigh != 101 {
		t.Fatalf("unexpected buy reference zone: %#v", rule)
	}
	if rule.ValidTradingDays != 5 {
		t.Fatalf("valid trading days = %d, want 5", rule.ValidTradingDays)
	}
}
