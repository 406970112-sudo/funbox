package feedback

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
)

const (
	MinDescriptionRunes  = 10
	MaxDescriptionRunes  = 1000
	MinFeatureTitleRunes = 5
	MaxFeatureTitleRunes = 40
	MinAdminReplyRunes   = 10
	MaxAdminReplyRunes   = 1000
	KindProblem          = "problem"
	KindFeatureRequest   = "feature_request"
	StatusPending        = "pending"
	StatusProcessing     = "processing"
	StatusResolved       = "resolved"
)

var (
	ErrDescriptionInvalid = errors.New("feedback description is invalid")
	ErrImageTypeInvalid   = errors.New("feedback image type is invalid")
	ErrImageTooLarge      = errors.New("feedback image is too large")
	ErrImagesTooMany      = errors.New("feedback has too many images")
	ErrKindInvalid        = errors.New("feedback kind is invalid")
	ErrTitleInvalid       = errors.New("feedback title is invalid")
	ErrCategoryInvalid    = errors.New("feedback category is invalid")
	ErrStatusInvalid      = errors.New("feedback status is invalid")
	ErrReplyInvalid       = errors.New("feedback reply is invalid")
)

var allowedFeedbackCategories = map[string]bool{
	"tool":       true,
	"game":       true,
	"social":     true,
	"reading":    true,
	"efficiency": true,
	"other":      true,
}

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

func NormalizeDescription(value string) (string, error) {
	normalized := strings.TrimSpace(value)
	length := utf8.RuneCountInString(normalized)
	if length < MinDescriptionRunes || length > MaxDescriptionRunes {
		return "", ErrDescriptionInvalid
	}
	return normalized, nil
}

func NormalizeKind(value string) (string, error) {
	normalized := strings.TrimSpace(value)
	if normalized == "" {
		return KindProblem, nil
	}
	if normalized != KindProblem && normalized != KindFeatureRequest {
		return "", ErrKindInvalid
	}
	return normalized, nil
}

func NormalizeFeatureTitle(value string) (string, error) {
	normalized := strings.TrimSpace(value)
	length := utf8.RuneCountInString(normalized)
	if length < MinFeatureTitleRunes || length > MaxFeatureTitleRunes {
		return "", ErrTitleInvalid
	}
	return normalized, nil
}

func NormalizeCategory(value string) (string, error) {
	normalized := strings.TrimSpace(value)
	if !allowedFeedbackCategories[normalized] {
		return "", ErrCategoryInvalid
	}
	return normalized, nil
}

func NormalizeAdminReply(value string) (string, error) {
	normalized := strings.TrimSpace(value)
	length := utf8.RuneCountInString(normalized)
	if length < MinAdminReplyRunes || length > MaxAdminReplyRunes {
		return "", ErrReplyInvalid
	}
	return normalized, nil
}

func (s *Service) Create(
	ctx context.Context,
	userID string,
	kind string,
	title string,
	category string,
	description string,
	uploads []Upload,
) (Submission, error) {
	normalizedKind, err := NormalizeKind(kind)
	if err != nil {
		return Submission{}, err
	}
	normalizedTitle := ""
	normalizedCategory := ""
	if normalizedKind == KindFeatureRequest {
		normalizedTitle, err = NormalizeFeatureTitle(title)
		if err != nil {
			return Submission{}, err
		}
		normalizedCategory, err = NormalizeCategory(category)
		if err != nil {
			return Submission{}, err
		}
	}
	normalized, err := NormalizeDescription(description)
	if err != nil {
		return Submission{}, err
	}
	if len(uploads) > s.maxImages {
		return Submission{}, ErrImagesTooMany
	}

	if len(uploads) > 0 {
		if err := os.MkdirAll(s.storageDir, 0o755); err != nil {
			return Submission{}, fmt.Errorf("create feedback storage directory: %w", err)
		}
	}

	images := make([]Image, 0, len(uploads))
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
			return Submission{}, fmt.Errorf("read feedback image: %w", err)
		}
		if int64(len(contents)) > s.maxImageBytes {
			cleanup()
			return Submission{}, ErrImageTooLarge
		}

		extension, contentType, err := detectFeedbackImage(contents)
		if err != nil {
			cleanup()
			return Submission{}, err
		}
		imageID := uuid.NewString()
		image := Image{
			ID:          imageID,
			StoredName:  imageID + extension,
			ContentType: contentType,
			SizeBytes:   int64(len(contents)),
			SortOrder:   index,
		}
		filePath := filepath.Join(s.storageDir, image.StoredName)
		if err := writeFeedbackFileAtomically(filePath, contents); err != nil {
			cleanup()
			return Submission{}, fmt.Errorf("write feedback image: %w", err)
		}
		writtenPaths = append(writtenPaths, filePath)
		images = append(images, image)
	}

	created, err := s.store.CreateWithType(
		ctx,
		userID,
		normalizedKind,
		normalizedTitle,
		normalizedCategory,
		normalized,
		images,
	)
	if err != nil {
		cleanup()
		return Submission{}, fmt.Errorf("store feedback submission: %w", err)
	}
	return created, nil
}

func (s *Service) List(ctx context.Context, opts ListOptions) (Page, error) {
	return s.store.ListFiltered(ctx, opts)
}

func (s *Service) ListByUser(ctx context.Context, userID string, limit, offset int) (Page, error) {
	return s.store.ListByUser(ctx, userID, limit, offset)
}

func (s *Service) ListNotifications(ctx context.Context, userID string, limit, offset int) (Page, error) {
	return s.store.ListNotifications(ctx, userID, limit, offset)
}

func (s *Service) Get(ctx context.Context, feedbackID string) (Submission, error) {
	return s.store.Get(ctx, feedbackID)
}

func (s *Service) GetByUser(ctx context.Context, userID string, feedbackID string) (Submission, error) {
	return s.store.GetByUser(ctx, userID, feedbackID)
}

func (s *Service) UnreadCount(ctx context.Context, userID string) (int, error) {
	return s.store.UnreadCount(ctx, userID)
}

func (s *Service) MarkNotificationsRead(ctx context.Context, userID string, feedbackIDs []string) error {
	return s.store.MarkNotificationsRead(ctx, userID, feedbackIDs)
}

func (s *Service) Resolve(
	ctx context.Context,
	feedbackID string,
	adminUserID string,
	status string,
	reply string,
) (Submission, error) {
	if status != StatusProcessing && status != StatusResolved {
		return Submission{}, ErrStatusInvalid
	}
	current, err := s.store.Get(ctx, feedbackID)
	if err != nil {
		return Submission{}, err
	}
	if status == StatusProcessing && current.Status == StatusResolved {
		return Submission{}, ErrStatusInvalid
	}
	normalizedReply := ""
	if status == StatusResolved {
		normalizedReply, err = NormalizeAdminReply(reply)
		if err != nil {
			return Submission{}, err
		}
	}
	return s.store.Resolve(ctx, feedbackID, adminUserID, status, normalizedReply)
}

func (s *Service) GetImage(ctx context.Context, feedbackID, imageID string) (Image, error) {
	return s.store.GetImage(ctx, feedbackID, imageID)
}

func (s *Service) ImagePath(image Image) string {
	return filepath.Join(s.storageDir, image.StoredName)
}

func detectFeedbackImage(contents []byte) (extension string, contentType string, err error) {
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

func writeFeedbackFileAtomically(filePath string, contents []byte) error {
	temporary, err := os.CreateTemp(filepath.Dir(filePath), ".feedback-*")
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
