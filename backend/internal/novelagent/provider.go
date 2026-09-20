package novelagent

import (
	"encoding/json"
	"fmt"
	"io"
	"strings"
)

type Provider interface {
	Generate(ctx Context, request GenerateRequest) (GenerateResponse, error)
}

// Context is kept as an alias so provider implementations cannot accidentally
// accept an unbounded request context from another abstraction.
type Context interface {
	Done() <-chan struct{}
	Err() error
}

func DecodeJSON(raw string, target any) error {
	decoder := json.NewDecoder(strings.NewReader(normalizeJSON(raw)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return fmt.Errorf("decode model JSON: %w", err)
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		if err == nil {
			return fmt.Errorf("decode model JSON: trailing content")
		}
		return fmt.Errorf("decode model JSON: %w", err)
	}
	return nil
}

func normalizeJSON(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if !strings.HasPrefix(trimmed, "```") {
		return trimmed
	}
	if firstLineEnd := strings.Index(trimmed, "\n"); firstLineEnd >= 0 {
		trimmed = trimmed[firstLineEnd+1:]
	}
	return strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(trimmed), "```"))
}
