package feedback

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestServiceRejectsInvalidDescriptionAndImages(t *testing.T) {
	service, userID, _ := openFeedbackTestService(t, 16, 3)
	if _, err := service.Create(context.Background(), userID, "problem", "", "", "  too short ", nil); !errors.Is(err, ErrDescriptionInvalid) {
		t.Fatalf("got %v", err)
	}
	bad := Upload{Reader: strings.NewReader("not-an-image")}
	if _, err := service.Create(
		context.Background(),
		userID,
		"problem",
		"",
		"",
		"this is a valid feedback description",
		[]Upload{bad},
	); !errors.Is(err, ErrImageTypeInvalid) {
		t.Fatalf("got %v", err)
	}
	tooLarge := Upload{Reader: bytes.NewReader(append(pngHeader(t), bytes.Repeat([]byte{1}, 9)...))}
	if _, err := service.Create(
		context.Background(),
		userID,
		"problem",
		"",
		"",
		"this is a valid feedback description",
		[]Upload{tooLarge},
	); !errors.Is(err, ErrImageTooLarge) {
		t.Fatalf("got %v", err)
	}
}

func TestServicePersistsMultipleImagesInSelectionOrder(t *testing.T) {
	service, userID, storageDir := openFeedbackTestService(t, 5<<20, 3)
	created, err := service.Create(context.Background(), userID, "problem", "", "", "images keep selection order", []Upload{
		{Reader: bytes.NewReader(encodeTestImage(t, "png"))},
		{Reader: bytes.NewReader(encodeTestImage(t, "jpeg"))},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(created.Images) != 2 || created.Images[0].SortOrder != 0 || created.Images[1].SortOrder != 1 {
		t.Fatalf("unexpected images: %#v", created.Images)
	}
	for _, image := range created.Images {
		if _, err := os.Stat(filepath.Join(storageDir, image.StoredName)); err != nil {
			t.Fatal(err)
		}
	}
}

func TestServiceCleansUpFilesWhenStoreFails(t *testing.T) {
	service, _, storageDir := openFeedbackTestService(t, 5<<20, 3)
	if _, err := service.Create(context.Background(), "missing-user", "problem", "", "", "valid feedback description here", []Upload{
		{Reader: bytes.NewReader(encodeTestImage(t, "png"))},
	}); err == nil {
		t.Fatal("expected store failure for missing user")
	}
	entries, err := os.ReadDir(storageDir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("expected no leftover files, got %d", len(entries))
	}
}

func openFeedbackTestService(t *testing.T, maxBytes int64, maxImages int) (*Service, string, string) {
	t.Helper()
	store, userID := openFeedbackTestStore(t)
	storageDir := filepath.Join(t.TempDir(), "feedback-images")
	return NewService(store, storageDir, maxBytes, maxImages), userID, storageDir
}

func encodeTestImage(t *testing.T, format string) []byte {
	t.Helper()
	buffer := &bytes.Buffer{}
	value := image.NewRGBA(image.Rect(0, 0, 2, 2))
	value.Set(0, 0, color.RGBA{R: 75, G: 107, B: 255, A: 255})
	var err error
	if format == "png" {
		err = png.Encode(buffer, value)
	} else {
		err = jpeg.Encode(buffer, value, nil)
	}
	if err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func pngHeader(t *testing.T) []byte {
	t.Helper()
	return encodeTestImage(t, "png")[:8]
}

func TestServiceListAndGetImageProxies(t *testing.T) {
	service, userID, _ := openFeedbackTestService(t, 5<<20, 3)
	created, err := service.Create(context.Background(), userID, "problem", "", "", "proxy list and image lookup", []Upload{
		{Reader: bytes.NewReader(encodeTestImage(t, "png"))},
	})
	if err != nil {
		t.Fatal(err)
	}
	page, err := service.List(context.Background(), ListOptions{Limit: 30, Offset: 0})
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 1 {
		t.Fatalf("unexpected total: %d", page.Total)
	}
	image, err := service.GetImage(context.Background(), created.ID, created.Images[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if image.StoredName != created.Images[0].StoredName {
		t.Fatalf("unexpected image: %#v", image)
	}
	if service.ImagePath(image) == "" {
		t.Fatal("image path is empty")
	}
}
