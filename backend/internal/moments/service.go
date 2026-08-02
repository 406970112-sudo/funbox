package moments

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

func (s *Service) Create(
	ctx context.Context,
	userID string,
	body string,
	visibility string,
	uploads []Upload,
	attachment *Attachment,
) (Moment, error) {
	if len(uploads) > s.maxImages {
		return Moment{}, ErrImagesTooMany
	}
	if len(uploads) > 0 {
		if err := os.MkdirAll(s.storageDir, 0o755); err != nil {
			return Moment{}, fmt.Errorf("create moments storage directory: %w", err)
		}
	}

	media := make([]Media, 0, len(uploads))
	writtenPaths := make([]string, 0, len(uploads))
	cleanup := func() {
		for _, filePath := range writtenPaths {
			_ = os.Remove(filePath)
		}
	}

	for index, upload := range uploads {
		contents, err := io.ReadAll(io.LimitReader(upload.Reader, s.maxImageBytes+1))
		if err != nil {
			cleanup()
			return Moment{}, fmt.Errorf("read moment image: %w", err)
		}
		if int64(len(contents)) > s.maxImageBytes {
			cleanup()
			return Moment{}, ErrImageTooLarge
		}
		extension, contentType, err := detectMomentImage(contents)
		if err != nil {
			cleanup()
			return Moment{}, err
		}
		item := Media{
			ID:          uuid.NewString(),
			StoredName:  uuid.NewString() + extension,
			ContentType: contentType,
			SortOrder:   index,
		}
		filePath := filepath.Join(s.storageDir, item.StoredName)
		if err := writeMomentFileAtomically(filePath, contents); err != nil {
			cleanup()
			return Moment{}, fmt.Errorf("write moment image: %w", err)
		}
		writtenPaths = append(writtenPaths, filePath)
		media = append(media, item)
	}

	created, err := s.store.Create(ctx, userID, body, visibility, media, attachment)
	if err != nil {
		cleanup()
		return Moment{}, err
	}
	return created, nil
}

func (s *Service) Store() *Store {
	return s.store
}

func (s *Service) ImagePath(media Media) string {
	return filepath.Join(s.storageDir, media.StoredName)
}

func detectMomentImage(contents []byte) (extension string, contentType string, err error) {
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

func writeMomentFileAtomically(filePath string, contents []byte) error {
	temporary, err := os.CreateTemp(filepath.Dir(filePath), ".moment-*")
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
		return errors.New("moment_image_type_invalid")
	case errors.Is(err, ErrImageTooLarge):
		return errors.New("moment_image_too_large")
	case errors.Is(err, ErrImagesTooMany):
		return errors.New("moment_images_too_many")
	case errors.Is(err, ErrBodyInvalid):
		return errors.New("moment_body_invalid")
	case errors.Is(err, ErrAttachmentInvalid):
		return errors.New("moment_attachment_invalid")
	case errors.Is(err, ErrNotFound):
		return errors.New("not_found")
	case errors.Is(err, ErrForbidden):
		return errors.New("forbidden")
	case errors.Is(err, ErrCommentInvalid):
		return errors.New("comment_invalid")
	case errors.Is(err, ErrReportExists):
		return errors.New("report_exists")
	default:
		if strings.Contains(err.Error(), "moment record not found") {
			return errors.New("not_found")
		}
		return errors.New("moments_request_failed")
	}
}
