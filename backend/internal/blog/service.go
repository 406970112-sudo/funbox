package blog

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

type CoverUpload struct {
	Reader io.Reader
}

type Service struct {
	store         *Store
	storageDir    string
	maxCoverBytes int64
}

func NewService(store *Store, storageDir string, maxCoverBytes int64) *Service {
	return &Service{
		store:         store,
		storageDir:    storageDir,
		maxCoverBytes: maxCoverBytes,
	}
}

func (s *Service) Store() *Store {
	return s.store
}

func (s *Service) CoverPath(coverPath string) string {
	if strings.TrimSpace(coverPath) == "" {
		return ""
	}
	return filepath.Join(s.storageDir, filepath.Base(coverPath))
}

func (s *Service) Create(
	ctx context.Context,
	authorID string,
	title string,
	summary string,
	body string,
	cover *CoverUpload,
	visibility string,
) (Post, error) {
	coverPath := ""
	if cover != nil && cover.Reader != nil {
		var err error
		coverPath, err = s.storeCover(cover)
		if err != nil {
			return Post{}, err
		}
	}
	created, err := s.store.Create(ctx, authorID, title, summary, body, coverPath, visibility)
	if err != nil {
		if coverPath != "" {
			_ = os.Remove(s.CoverPath(coverPath))
		}
		return Post{}, err
	}
	return created, nil
}

func (s *Service) ReplaceCover(
	ctx context.Context,
	userID string,
	postID string,
	cover *CoverUpload,
) (Post, error) {
	if cover == nil || cover.Reader == nil {
		return Post{}, ErrCoverInvalid
	}
	current, err := s.store.Get(ctx, userID, postID)
	if err != nil {
		return Post{}, err
	}
	coverPath, err := s.storeCover(cover)
	if err != nil {
		return Post{}, err
	}
	updated, err := s.store.UpdateCover(ctx, userID, postID, coverPath)
	if err != nil {
		_ = os.Remove(s.CoverPath(coverPath))
		return Post{}, err
	}
	if current.CoverPath != "" {
		_ = os.Remove(s.CoverPath(current.CoverPath))
	}
	return updated, nil
}

func (s *Service) storeCover(cover *CoverUpload) (string, error) {
	if err := os.MkdirAll(s.storageDir, 0o755); err != nil {
		return "", fmt.Errorf("create blog cover directory: %w", err)
	}
	maxBytes := s.maxCoverBytes
	if maxBytes <= 0 {
		maxBytes = 2 << 20
	}
	contents, err := io.ReadAll(io.LimitReader(cover.Reader, maxBytes+1))
	if err != nil {
		return "", fmt.Errorf("read blog cover: %w", err)
	}
	if int64(len(contents)) > maxBytes {
		return "", ErrCoverTooLarge
	}
	extension, _, err := detectCover(contents)
	if err != nil {
		return "", err
	}
	storedName := uuid.NewString() + extension
	filePath := filepath.Join(s.storageDir, storedName)
	if err := writeCoverFileAtomically(filePath, contents); err != nil {
		return "", fmt.Errorf("write blog cover: %w", err)
	}
	return storedName, nil
}

func detectCover(contents []byte) (string, string, error) {
	contentType := http.DetectContentType(contents)
	switch contentType {
	case "image/jpeg":
		return ".jpg", contentType, nil
	case "image/png":
		return ".png", contentType, nil
	case "image/webp":
		return ".webp", contentType, nil
	default:
		return "", "", ErrCoverInvalid
	}
}

func writeCoverFileAtomically(filePath string, contents []byte) error {
	temporary, err := os.CreateTemp(filepath.Dir(filePath), ".blog-cover-*")
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

func NormalizeErrors(err error) error {
	switch {
	case errors.Is(err, ErrNotFound):
		return errors.New("not_found")
	case errors.Is(err, ErrForbidden):
		return errors.New("forbidden")
	case errors.Is(err, ErrBodyInvalid):
		return errors.New("blog_post_invalid")
	case errors.Is(err, ErrCommentInvalid):
		return errors.New("comment_invalid")
	case errors.Is(err, ErrCoverInvalid):
		return errors.New("blog_cover_type_invalid")
	case errors.Is(err, ErrCoverTooLarge):
		return errors.New("blog_cover_too_large")
	case errors.Is(err, ErrReportExists):
		return errors.New("report_exists")
	default:
		if strings.Contains(err.Error(), "blog record not found") {
			return errors.New("not_found")
		}
		return errors.New("blog_request_failed")
	}
}
