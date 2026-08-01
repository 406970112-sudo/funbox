package membership

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
)

const MaxPaymentNoteRunes = 200

var (
	ErrImageTypeInvalid = errors.New("payment qr image type is invalid")
	ErrImageTooLarge    = errors.New("payment qr image is too large")
	ErrNoteInvalid      = errors.New("payment note is invalid")
)

type Plan struct {
	Tier       string
	PriceCents int
	Period     string
}

type PaymentInfo struct {
	Enabled bool
	QRPath  string
	Note    string
	Plans   []Plan
}

type Service struct {
	store      *Store
	storageDir string
	maxBytes   int64
}

func NewService(store *Store, storageDir string, maxBytes int64) *Service {
	return &Service{store: store, storageDir: storageDir, maxBytes: maxBytes}
}

func (s *Service) PublicPaymentInfo(ctx context.Context) (PaymentInfo, error) {
	settings, err := s.store.Get(ctx)
	if err != nil {
		return PaymentInfo{}, err
	}
	enabled := settings.PaymentQRFile != ""
	qrPath := ""
	if enabled {
		qrPath = "/payment-qr/" + settings.PaymentQRFile
	}
	return PaymentInfo{
		Enabled: enabled,
		QRPath:  qrPath,
		Note:    settings.PaymentNote,
		Plans: []Plan{
			{Tier: "vip", PriceCents: settings.VIPPriceCents, Period: "month"},
			{Tier: "svip", PriceCents: settings.SVIPPriceCents, Period: "month"},
		},
	}, nil
}

func (s *Service) Settings(ctx context.Context) (Settings, error) {
	return s.store.Get(ctx)
}

func (s *Service) ListChanges(ctx context.Context, limit, offset int) (ChangesPage, error) {
	return s.store.ListChanges(ctx, limit, offset)
}

func (s *Service) UploadPaymentQR(
	ctx context.Context,
	operatorID string,
	contents []byte,
) (Settings, error) {
	maxBytes := s.maxBytes
	if maxBytes <= 0 {
		maxBytes = 2 << 20
	}
	if int64(len(contents)) > maxBytes {
		return Settings{}, ErrImageTooLarge
	}

	extension, err := detectPaymentQRImage(contents)
	if err != nil {
		return Settings{}, err
	}

	if err := os.MkdirAll(s.storageDir, 0o755); err != nil {
		return Settings{}, fmt.Errorf("create payment qr directory: %w", err)
	}
	fileName := "payment-qr-" + uuid.NewString() + extension
	filePath := filepath.Join(s.storageDir, fileName)
	if err := writePaymentQRFileAtomically(filePath, contents); err != nil {
		return Settings{}, fmt.Errorf("write payment qr image: %w", err)
	}

	previous, err := s.store.Get(ctx)
	if err != nil {
		_ = os.Remove(filePath)
		return Settings{}, err
	}

	updated, err := s.store.SetPaymentQR(ctx, operatorID, fileName)
	if err != nil {
		_ = os.Remove(filePath)
		return Settings{}, err
	}

	if previous.PaymentQRFile != "" && previous.PaymentQRFile != fileName {
		_ = os.Remove(filepath.Join(s.storageDir, filepath.Base(previous.PaymentQRFile)))
	}
	return updated, nil
}

func (s *Service) RemovePaymentQR(ctx context.Context, operatorID string) (Settings, error) {
	previous, err := s.store.Get(ctx)
	if err != nil {
		return Settings{}, err
	}
	updated, err := s.store.ClearPaymentQR(ctx, operatorID)
	if err != nil {
		return Settings{}, err
	}
	if previous.PaymentQRFile != "" {
		_ = os.Remove(filepath.Join(s.storageDir, filepath.Base(previous.PaymentQRFile)))
	}
	return updated, nil
}

func (s *Service) UpdatePaymentNote(
	ctx context.Context,
	operatorID string,
	note string,
) (Settings, error) {
	normalized := strings.TrimSpace(note)
	if normalized == "" || utf8.RuneCountInString(normalized) > MaxPaymentNoteRunes {
		return Settings{}, ErrNoteInvalid
	}
	return s.store.SetPaymentNote(ctx, operatorID, normalized)
}

func detectPaymentQRImage(contents []byte) (string, error) {
	switch http.DetectContentType(contents) {
	case "image/jpeg":
		return ".jpg", nil
	case "image/png":
		return ".png", nil
	case "image/webp":
		return ".webp", nil
	default:
		return "", ErrImageTypeInvalid
	}
}

func writePaymentQRFileAtomically(filePath string, contents []byte) error {
	temporary, err := os.CreateTemp(filepath.Dir(filePath), ".payment-qr-*")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)

	if _, err := temporary.Write(contents); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(temporaryPath, filePath)
}
