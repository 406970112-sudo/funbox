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
	dataKey []byte,
) (Media, error) {
	kind = strings.TrimSpace(kind)
	if kind != MediaKindImage && kind != MediaKindAudio {
		return Media{}, ErrInvalidInput
	}
	note, err := s.store.getNoteRecord(ctx, userID, noteID)
	if err != nil {
		return Media{}, err
	}
	if note.Encrypted && len(dataKey) == 0 {
		return Media{}, ErrLocked
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
	storedContents := contents
	if note.Encrypted {
		storedContents, err = encryptNotebookMedia(dataKey, contents)
		if err != nil {
			return Media{}, fmt.Errorf("encrypt notebook media: %w", err)
		}
	}
	if err := os.MkdirAll(s.mediaDir, 0o750); err != nil {
		return Media{}, fmt.Errorf("create notebook media directory: %w", err)
	}
	storedName := uuid.NewString() + extension
	filePath := filepath.Join(s.mediaDir, storedName)
	if err := writeFileAtomically(filePath, storedContents); err != nil {
		return Media{}, fmt.Errorf("write notebook media: %w", err)
	}
	item := Media{
		ID:          uuid.NewString(),
		NoteID:      noteID,
		OwnerID:     userID,
		Kind:        kind,
		ContentType: contentType,
		ByteSize:    int64(len(contents)),
		Encrypted:   note.Encrypted,
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

func (s *Service) ReadMedia(ctx context.Context, userID string, mediaID string, dataKey []byte) (Media, []byte, error) {
	media, filePath, err := s.GetMedia(ctx, userID, mediaID)
	if err != nil {
		return Media{}, nil, err
	}
	contents, err := os.ReadFile(filePath)
	if err != nil {
		return Media{}, nil, fmt.Errorf("read notebook media: %w", err)
	}
	if media.Encrypted {
		if len(dataKey) == 0 {
			return Media{}, nil, ErrLocked
		}
		contents, err = decryptNotebookMedia(dataKey, contents)
		if err != nil {
			return Media{}, nil, fmt.Errorf("decrypt notebook media: %w", err)
		}
	}
	return media, contents, nil
}

func (s *Service) DeleteMedia(ctx context.Context, userID string, mediaID string, dataKey []byte) error {
	media, _, err := s.store.GetMedia(ctx, userID, mediaID)
	if err != nil {
		return err
	}
	if media.Encrypted && len(dataKey) == 0 {
		return ErrLocked
	}
	storedName, err := s.store.DeleteMedia(ctx, userID, mediaID)
	if err != nil {
		return err
	}
	_ = os.Remove(filepath.Join(s.mediaDir, filepath.Base(storedName)))
	return nil
}

func (s *Service) ResetEncryption(ctx context.Context, userID string, confirmation string) error {
	storedNames, err := s.store.ResetEncryption(ctx, userID, confirmation)
	if err != nil {
		return err
	}
	for _, storedName := range storedNames {
		_ = os.Remove(filepath.Join(s.mediaDir, filepath.Base(storedName)))
	}
	return nil
}

func (s *Service) UpdateNote(ctx context.Context, userID string, noteID string, patch NotePatch, dataKey []byte) (Note, error) {
	current, err := s.store.getNoteRecord(ctx, userID, noteID)
	if err != nil {
		return Note{}, err
	}
	if current.Encrypted {
		if len(dataKey) == 0 {
			return Note{}, ErrLocked
		}
		if err := decryptNoteContent(&current, dataKey); err != nil {
			return Note{}, err
		}
	}
	state, err := s.store.mergeNotePatch(ctx, userID, current, patch)
	if err != nil {
		return Note{}, err
	}
	targetEncrypted := current.Encrypted
	if patch.Encrypted != nil {
		targetEncrypted = *patch.Encrypted
	}
	if targetEncrypted && len(dataKey) == 0 {
		return Note{}, ErrLocked
	}
	if targetEncrypted {
		if _, err := s.store.loadSecurityRecord(ctx, userID); err != nil {
			return Note{}, err
		}
	}
	if current.Encrypted != targetEncrypted {
		if err := s.updateNoteEncryption(ctx, userID, current, state, targetEncrypted, dataKey); err != nil {
			return Note{}, err
		}
		return s.store.GetNoteWithDataKey(ctx, userID, noteID, dataKey)
	}
	if targetEncrypted {
		payload, err := reencryptNotePayload(dataKey, current.noteKeyEnc, state.Title, state.Body, state.Checklist, state.Tags)
		if err != nil {
			return Note{}, fmt.Errorf("encrypt notebook note: %w", err)
		}
		version := current.encryptionVersion
		if version == 0 {
			version = NoteEncryptionVersion
		}
		if err := s.store.saveNoteState(ctx, userID, current, state, true, payload, current.noteKeyEnc, version); err != nil {
			return Note{}, err
		}
	} else if err := s.store.saveNoteState(ctx, userID, current, state, false, "", "", 0); err != nil {
		return Note{}, err
	}
	return s.store.GetNoteWithDataKey(ctx, userID, noteID, dataKey)
}

type stagedMedia struct {
	ID        string
	FinalPath string
	TempPath  string
	Original  []byte
}

func (s *Service) updateNoteEncryption(ctx context.Context, userID string, current Note, state noteWriteState, targetEncrypted bool, dataKey []byte) error {
	staged, err := s.prepareMediaEncryption(ctx, userID, current.ID, targetEncrypted, dataKey)
	if err != nil {
		return err
	}
	defer cleanupStagedMedia(staged)

	encryptedPayload := ""
	noteKeyEnc := ""
	encryptionVersion := 0
	if targetEncrypted {
		encryptedPayload, noteKeyEnc, err = newNoteEncryption(dataKey, state.Title, state.Body, state.Checklist, state.Tags)
		if err != nil {
			return fmt.Errorf("encrypt notebook note: %w", err)
		}
		encryptionVersion = NoteEncryptionVersion
	}

	tx, err := s.store.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin notebook encryption update: %w", err)
	}
	defer tx.Rollback()
	if err := s.store.saveNoteStateTx(ctx, tx, userID, current, state, targetEncrypted, encryptedPayload, noteKeyEnc, encryptionVersion); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE notebook_media SET encrypted = ? WHERE owner_id = ? AND note_id = ?
	`, boolInt(targetEncrypted), userID, current.ID); err != nil {
		return fmt.Errorf("update notebook media encryption: %w", err)
	}
	renamed, err := renameStagedMedia(staged)
	if err != nil {
		restoreStagedMedia(renamed)
		return fmt.Errorf("replace notebook media: %w", err)
	}
	if err := tx.Commit(); err != nil {
		restoreStagedMedia(renamed)
		return fmt.Errorf("commit notebook encryption update: %w", err)
	}
	return nil
}

func (s *Service) prepareMediaEncryption(ctx context.Context, userID, noteID string, targetEncrypted bool, dataKey []byte) ([]stagedMedia, error) {
	items, err := s.store.ListMedia(ctx, userID, noteID)
	if err != nil {
		return nil, err
	}
	staged := []stagedMedia{}
	for _, item := range items {
		if item.Encrypted == targetEncrypted {
			continue
		}
		filePath := filepath.Join(s.mediaDir, filepath.Base(item.StoredName))
		original, err := os.ReadFile(filePath)
		if err != nil {
			cleanupStagedMedia(staged)
			return nil, fmt.Errorf("read notebook media for encryption: %w", err)
		}
		transformed := original
		if targetEncrypted {
			transformed, err = encryptNotebookMedia(dataKey, original)
		} else {
			transformed, err = decryptNotebookMedia(dataKey, original)
		}
		if err != nil {
			cleanupStagedMedia(staged)
			return nil, fmt.Errorf("convert notebook media: %w", err)
		}
		temporary, err := os.CreateTemp(s.mediaDir, ".notebook-media-*")
		if err != nil {
			cleanupStagedMedia(staged)
			return nil, fmt.Errorf("stage notebook media: %w", err)
		}
		tempPath := temporary.Name()
		if _, err := temporary.Write(transformed); err != nil {
			_ = temporary.Close()
			_ = os.Remove(tempPath)
			cleanupStagedMedia(staged)
			return nil, fmt.Errorf("write notebook media stage: %w", err)
		}
		if err := temporary.Close(); err != nil {
			_ = os.Remove(tempPath)
			cleanupStagedMedia(staged)
			return nil, fmt.Errorf("close notebook media stage: %w", err)
		}
		staged = append(staged, stagedMedia{
			ID:        item.ID,
			FinalPath: filePath,
			TempPath:  tempPath,
			Original:  original,
		})
	}
	return staged, nil
}

func renameStagedMedia(staged []stagedMedia) ([]stagedMedia, error) {
	renamed := []stagedMedia{}
	for _, item := range staged {
		if err := os.Rename(item.TempPath, item.FinalPath); err != nil {
			return renamed, err
		}
		renamed = append(renamed, item)
	}
	return renamed, nil
}

func restoreStagedMedia(staged []stagedMedia) {
	for _, item := range staged {
		_ = writeFileAtomically(item.FinalPath, item.Original)
	}
}

func cleanupStagedMedia(staged []stagedMedia) {
	for _, item := range staged {
		_ = os.Remove(item.TempPath)
	}
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
