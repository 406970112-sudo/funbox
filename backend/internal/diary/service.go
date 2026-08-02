package diary

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/google/uuid"
)

type Upload struct {
	Reader io.Reader
}

type Service struct {
	store         *Store
	storageDir    string
	maxImageBytes int64
	maxImages     int
}

func NewService(store *Store, storageDir string, maxImageBytes int64, maxImages int) *Service {
	return &Service{
		store:         store,
		storageDir:    storageDir,
		maxImageBytes: maxImageBytes,
		maxImages:     maxImages,
	}
}

func (s *Service) Store() *Store {
	return s.store
}

func (s *Service) AddMedia(
	ctx context.Context,
	userID string,
	notebookID string,
	date string,
	uploads []Upload,
	dataKey []byte,
) (Entry, error) {
	if len(uploads) == 0 {
		return Entry{}, ErrInvalidInput
	}
	if len(uploads) > s.maxImages {
		return Entry{}, ErrImagesTooMany
	}
	entryID, err := s.store.GetEntryID(ctx, notebookID, date)
	if err != nil {
		return Entry{}, err
	}
	if err := os.MkdirAll(s.storageDir, 0o755); err != nil {
		return Entry{}, fmt.Errorf("create diary storage directory: %w", err)
	}
	written := []string{}
	cleanup := func() {
		for _, filePath := range written {
			_ = os.Remove(filePath)
		}
	}
	for index, upload := range uploads {
		contents, err := io.ReadAll(io.LimitReader(upload.Reader, s.maxImageBytes+1))
		if err != nil {
			cleanup()
			return Entry{}, fmt.Errorf("read diary image: %w", err)
		}
		if int64(len(contents)) > s.maxImageBytes {
			cleanup()
			return Entry{}, ErrImageTooLarge
		}
		extension, contentType, err := detectDiaryImage(contents)
		if err != nil {
			cleanup()
			return Entry{}, err
		}
		media := Media{
			ID:          uuid.NewString(),
			StoredName:  uuid.NewString() + extension,
			ContentType: contentType,
			SortOrder:   index,
		}
		filePath := filepath.Join(s.storageDir, media.StoredName)
		if err := writeDiaryFileAtomically(filePath, contents); err != nil {
			cleanup()
			return Entry{}, fmt.Errorf("write diary image: %w", err)
		}
		written = append(written, filePath)
		if err := s.store.AddMedia(ctx, entryID, media); err != nil {
			cleanup()
			return Entry{}, err
		}
	}
	return s.store.GetEntry(ctx, userID, notebookID, date, dataKey)
}

func (s *Service) DeleteMedia(ctx context.Context, userID string, notebookID string, mediaID string) (Media, error) {
	media, err := s.store.DeleteMedia(ctx, userID, notebookID, mediaID)
	if err != nil {
		return Media{}, err
	}
	_ = os.Remove(filepath.Join(s.storageDir, media.StoredName))
	return media, nil
}

func (s *Service) MediaPath(media Media) string {
	return filepath.Join(s.storageDir, media.StoredName)
}

func detectDiaryImage(contents []byte) (extension string, contentType string, err error) {
	contentType = http.DetectContentType(contents)
	switch contentType {
	case "image/jpeg":
		return ".jpg", contentType, nil
	case "image/png":
		return ".png", contentType, nil
	case "image/webp":
		return ".webp", contentType, nil
	default:
		return "", "", ErrImageTypeInvalid
	}
}

func writeDiaryFileAtomically(filePath string, contents []byte) error {
	temporary, err := os.CreateTemp(filepath.Dir(filePath), ".diary-*")
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

func NormalizeImageErrors(err error) error {
	switch {
	case errors.Is(err, ErrImageTypeInvalid):
		return errors.New("diary_image_type_invalid")
	case errors.Is(err, ErrImageTooLarge):
		return errors.New("diary_image_too_large")
	case errors.Is(err, ErrImagesTooMany):
		return errors.New("diary_images_too_many")
	default:
		return err
	}
}

func MediaURL(notebookID string, media Media, baseURL string) string {
	url := "/api/v1/diary/notebooks/" + notebookID + "/media/" + media.ID
	if strings.TrimSpace(baseURL) != "" {
		url = strings.TrimRight(strings.TrimSpace(baseURL), "/") + url
	}
	return url
}
