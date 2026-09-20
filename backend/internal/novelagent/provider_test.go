package novelagent

import (
	"context"
	"testing"
)

func TestDecodeJSONAcceptsCodeFencesAndRejectsUnknownFields(t *testing.T) {
	var result struct {
		Title string `json:"title"`
	}
	if err := DecodeJSON("```json\n{\"title\":\"灯塔\"}\n```", &result); err != nil {
		t.Fatalf("DecodeJSON() error = %v", err)
	}
	if result.Title != "灯塔" {
		t.Fatalf("Title = %q, want 灯塔", result.Title)
	}

	if err := DecodeJSON(`{"title":"灯塔","unexpected":true}`, &result); err == nil {
		t.Fatal("DecodeJSON() accepted an unknown field")
	}
}

func TestProviderContextAliasAcceptsContext(t *testing.T) {
	ctx := context.Background()
	if contextFromInterface(ctx) != ctx {
		t.Fatal("contextFromInterface did not preserve native context")
	}
}
