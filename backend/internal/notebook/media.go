package notebook

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

type Service struct {
	store    *Store
	mediaDir string
	maxBytes int64
}

func NewService(store *Store, mediaDir string, maxBytes int64) *Service {
	if maxBytes <= 0 {
		maxBytes = MaxAudioBytes
	}
	return &Service{store: store, mediaDir: strings.TrimSpace(mediaDir), maxBytes: maxBytes}
}

func (s *Service) Store() *Store {
	return s.store
}

func (s *Service) UploadMedia(
	ctx context.Context,
	userID string,
	noteID string,
	kind string,
	fileName string,
	reader io.Reader,
) (Media, error) {
	kind = strings.TrimSpace(kind)
	if kind != MediaKindImage && kind != MediaKindAudio {
		return Media{}, ErrInvalidInput
	}
	if _, err := s.store.GetNote(ctx, userID, noteID); err != nil {
		return Media{}, err
	}
	count, err := s.store.CountMedia(ctx, userID, noteID, kind)
	if err != nil {
		return Media{}, err
	}
	if (kind == MediaKindImage && count >= MaxImagesPerNote) || (kind == MediaKindAudio && count >= MaxAudioPerNote) {
		return Media{}, ErrMediaLimitReached
	}
	limit := s.maxBytes
	if kind == MediaKindImage && limit > MaxImageBytes {
		limit = MaxImageBytes
	}
	if kind == MediaKindAudio && limit > MaxAudioBytes {
		limit = MaxAudioBytes
	}
	contents, err := io.ReadAll(io.LimitReader(reader, limit+1))
	if err != nil {
		return Media{}, fmt.Errorf("read notebook media: %w", err)
	}
	if int64(len(contents)) > limit {
		return Media{}, ErrMediaTooLarge
	}
	extension, contentType, err := detectMedia(kind, fileName, contents)
	if err != nil {
		return Media{}, err
	}
	if err := os.MkdirAll(s.mediaDir, 0o750); err != nil {
		return Media{}, fmt.Errorf("create notebook media directory: %w", err)
	}
	storedName := uuid.NewString() + extension
	filePath := filepath.Join(s.mediaDir, storedName)
	if err := writeFileAtomically(filePath, contents); err != nil {
		return Media{}, fmt.Errorf("write notebook media: %w", err)
	}
	item := Media{
		ID:          uuid.NewString(),
		NoteID:      noteID,
		OwnerID:     userID,
		Kind:        kind,
		ContentType: contentType,
		ByteSize:    int64(len(contents)),
	}
	created, err := s.store.CreateMedia(ctx, item, storedName)
	if err != nil {
		_ = os.Remove(filePath)
		return Media{}, err
	}
	return created, nil
}

func (s *Service) GetMedia(ctx context.Context, userID string, mediaID string) (Media, string, error) {
	media, storedName, err := s.store.GetMedia(ctx, userID, mediaID)
	if err != nil {
		return Media{}, "", err
	}
	filePath := filepath.Join(s.mediaDir, filepath.Base(storedName))
	if _, err := os.Stat(filePath); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return Media{}, "", ErrNotFound
		}
		return Media{}, "", fmt.Errorf("stat notebook media: %w", err)
	}
	return media, filePath, nil
}

func (s *Service) DeleteMedia(ctx context.Context, userID string, mediaID string) error {
	storedName, err := s.store.DeleteMedia(ctx, userID, mediaID)
	if err != nil {
		return err
	}
	_ = os.Remove(filepath.Join(s.mediaDir, filepath.Base(storedName)))
	return nil
}

func MediaURL(media Media) string {
	if media.ID == "" {
		return ""
	}
	return "/api/v1/notebook/media/" + media.ID
}

func detectMedia(kind string, fileName string, contents []byte) (string, string, error) {
	detected := strings.ToLower(strings.TrimSpace(strings.Split(http.DetectContentType(contents), ";")[0]))
	extension := strings.ToLower(filepath.Ext(fileName))
	if kind == MediaKindImage {
		switch detected {
		case "image/jpeg":
			return ".jpg", "image/jpeg", nil
		case "image/png":
			return ".png", "image/png", nil
		case "image/webp":
			return ".webp", "image/webp", nil
		case "image/gif":
			return ".gif", "image/gif", nil
		default:
			return "", "", ErrMediaTypeInvalid
		}
	}
	if strings.HasPrefix(detected, "audio/") {
		switch detected {
		case "audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/mp4a-latm", "audio/aac", "audio/x-aac", "audio/wav", "audio/wave", "audio/x-wav", "audio/ogg":
			if extension == "" {
				extension = extensionForAudio(detected)
			}
			return extension, detected, nil
		}
	}
	if detected == "application/octet-stream" {
		switch extension {
		case ".mp3":
			return ".mp3", "audio/mpeg", nil
		case ".m4a":
			return ".m4a", "audio/mp4", nil
		case ".aac":
			return ".aac", "audio/aac", nil
		case ".wav":
			return ".wav", "audio/wav", nil
		}
	}
	return "", "", ErrMediaTypeInvalid
}

func extensionForAudio(contentType string) string {
	switch contentType {
	case "audio/mpeg":
		return ".mp3"
	case "audio/mp4":
		return ".m4a"
	case "audio/aac":
		return ".aac"
	case "audio/wav", "audio/wave", "audio/x-wav":
		return ".wav"
	case "audio/ogg":
		return ".ogg"
	default:
		return ""
	}
}

func writeFileAtomically(filePath string, contents []byte) error {
	temporary, err := os.CreateTemp(filepath.Dir(filePath), ".notebook-*")
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
