package auth

import (
	"crypto/rand"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const signingKeyBytes = 32

func ResolveSigningKey(configuredSecret string, secretFile string) ([]byte, error) {
	if configured := strings.TrimSpace(configuredSecret); configured != "" {
		if len(configured) < signingKeyBytes {
			return nil, fmt.Errorf("AUTH_JWT_SECRET must contain at least %d characters", signingKeyBytes)
		}
		return []byte(configured), nil
	}

	if strings.TrimSpace(secretFile) == "" {
		return nil, errors.New("AUTH_JWT_SECRET_FILE is required when AUTH_JWT_SECRET is empty")
	}

	if existing, err := os.ReadFile(secretFile); err == nil {
		if len(existing) < signingKeyBytes {
			return nil, errors.New("stored JWT signing key is invalid")
		}
		return existing, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, fmt.Errorf("read JWT signing key: %w", err)
	}

	if err := os.MkdirAll(filepath.Dir(secretFile), 0o700); err != nil {
		return nil, fmt.Errorf("create JWT key directory: %w", err)
	}

	generated := make([]byte, signingKeyBytes)
	if _, err := rand.Read(generated); err != nil {
		return nil, fmt.Errorf("generate JWT signing key: %w", err)
	}

	file, err := os.OpenFile(secretFile, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if errors.Is(err, os.ErrExist) {
		return ResolveSigningKey("", secretFile)
	}
	if err != nil {
		return nil, fmt.Errorf("create JWT signing key: %w", err)
	}
	if _, err := file.Write(generated); err != nil {
		file.Close()
		return nil, fmt.Errorf("write JWT signing key: %w", err)
	}
	if err := file.Close(); err != nil {
		return nil, fmt.Errorf("close JWT signing key: %w", err)
	}

	return generated, nil
}
