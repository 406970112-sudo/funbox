package membership

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestPublicPaymentInfoReturnsDefaultPlans(t *testing.T) {
	store, err := OpenStore(":memory:")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	service := NewService(store, t.TempDir(), 2<<20)

	info, err := service.PublicPaymentInfo(context.Background())
	if err != nil {
		t.Fatalf("public payment info: %v", err)
	}
	if info.Enabled {
		t.Fatal("default payment info must be disabled")
	}
	if len(info.Plans) != 2 ||
		info.Plans[0].Tier != "vip" || info.Plans[0].PriceCents != 200 ||
		info.Plans[1].Tier != "svip" || info.Plans[1].PriceCents != 500 {
		t.Fatalf("plans = %+v", info.Plans)
	}
	if strings.TrimSpace(info.Note) == "" {
		t.Fatal("default payment note must not be empty")
	}
}

func TestUploadPaymentQRRejectsUnsupportedType(t *testing.T) {
	store, err := OpenStore(":memory:")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	service := NewService(store, t.TempDir(), 2<<20)

	_, err = service.UploadPaymentQR(context.Background(), "operator", []byte("not an image"))
	if !errors.Is(err, ErrImageTypeInvalid) {
		t.Fatalf("err = %v, want ErrImageTypeInvalid", err)
	}
}

func TestUpdatePaymentNoteRejectsOversizedNote(t *testing.T) {
	store, err := OpenStore(":memory:")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	service := NewService(store, t.TempDir(), 2<<20)

	_, err = service.UpdatePaymentNote(
		context.Background(),
		"operator",
		strings.Repeat("长", MaxPaymentNoteRunes+1),
	)
	if !errors.Is(err, ErrNoteInvalid) {
		t.Fatalf("err = %v, want ErrNoteInvalid", err)
	}
}
