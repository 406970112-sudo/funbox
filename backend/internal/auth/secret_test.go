package auth_test

import (
	"bytes"
	"path/filepath"
	"testing"

	"my-first-expo-app/backend/internal/auth"
)

func TestResolveSigningKeyPersistsGeneratedKey(t *testing.T) {
	secretPath := filepath.Join(t.TempDir(), "auth", "jwt-secret")
	first, err := auth.ResolveSigningKey("", secretPath)
	if err != nil {
		t.Fatalf("generate signing key: %v", err)
	}
	second, err := auth.ResolveSigningKey("", secretPath)
	if err != nil {
		t.Fatalf("read signing key: %v", err)
	}
	if len(first) != 32 {
		t.Fatalf("generated key length = %d", len(first))
	}
	if !bytes.Equal(first, second) {
		t.Fatal("stored key changed between reads")
	}
}
