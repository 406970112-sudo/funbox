package authstorage

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"modernc.org/sqlite"
)

type Paths struct {
	Database  string
	AvatarDir string
	JWTSecret string
}

type Result struct {
	Migrated          bool
	AvatarFilesCopied int
}

func Migrate(ctx context.Context, source Paths, target Paths) (Result, error) {
	if _, err := os.Stat(target.Database); err == nil {
		return Result{}, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return Result{}, fmt.Errorf("inspect target database: %w", err)
	}

	if _, err := os.Stat(source.Database); errors.Is(err, os.ErrNotExist) {
		return Result{}, nil
	} else if err != nil {
		return Result{}, fmt.Errorf("inspect source database: %w", err)
	}

	if err := os.MkdirAll(filepath.Dir(target.Database), 0o750); err != nil {
		return Result{}, fmt.Errorf("create target database directory: %w", err)
	}
	if err := os.MkdirAll(target.AvatarDir, 0o755); err != nil {
		return Result{}, fmt.Errorf("create target avatar directory: %w", err)
	}

	temporaryDatabase, err := reserveTemporaryPath(filepath.Dir(target.Database), ".auth-storage-*.db")
	if err != nil {
		return Result{}, fmt.Errorf("reserve temporary database path: %w", err)
	}
	defer os.Remove(temporaryDatabase)

	if err := backupDatabase(ctx, source.Database, temporaryDatabase); err != nil {
		return Result{}, fmt.Errorf("backup source database: %w", err)
	}
	if err := os.Chmod(temporaryDatabase, 0o640); err != nil {
		return Result{}, fmt.Errorf("set migrated database permissions: %w", err)
	}

	avatarFiles, err := referencedAvatarFiles(ctx, temporaryDatabase)
	if err != nil {
		return Result{}, fmt.Errorf("read referenced avatars: %w", err)
	}
	for _, fileName := range avatarFiles {
		if filepath.Base(fileName) != fileName || fileName == "." {
			return Result{}, fmt.Errorf("invalid avatar file name %q", fileName)
		}
		if err := copyFileAtomically(
			filepath.Join(source.AvatarDir, fileName),
			filepath.Join(target.AvatarDir, fileName),
			0o644,
		); err != nil {
			return Result{}, fmt.Errorf("copy avatar %q: %w", fileName, err)
		}
	}

	if _, err := os.Stat(source.JWTSecret); err == nil {
		if err := copyFileAtomically(source.JWTSecret, target.JWTSecret, 0o600); err != nil {
			return Result{}, fmt.Errorf("copy JWT secret: %w", err)
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return Result{}, fmt.Errorf("inspect source JWT secret: %w", err)
	}

	if err := os.Rename(temporaryDatabase, target.Database); err != nil {
		return Result{}, fmt.Errorf("publish migrated database: %w", err)
	}

	return Result{Migrated: true, AvatarFilesCopied: len(avatarFiles)}, nil
}

type backupConnection interface {
	NewBackup(string) (*sqlite.Backup, error)
}

func backupDatabase(ctx context.Context, sourcePath string, targetPath string) error {
	database, err := sql.Open("sqlite", sourcePath)
	if err != nil {
		return err
	}
	defer database.Close()

	connection, err := database.Conn(ctx)
	if err != nil {
		return err
	}
	defer connection.Close()

	return connection.Raw(func(driverConnection any) error {
		backuper, ok := driverConnection.(backupConnection)
		if !ok {
			return errors.New("sqlite driver does not support online backup")
		}
		backup, err := backuper.NewBackup(targetPath)
		if err != nil {
			return err
		}
		for more := true; more; {
			more, err = backup.Step(-1)
			if err != nil {
				_ = backup.Finish()
				return err
			}
		}
		return backup.Finish()
	})
}

func referencedAvatarFiles(ctx context.Context, databasePath string) ([]string, error) {
	database, err := sql.Open("sqlite", databasePath)
	if err != nil {
		return nil, err
	}
	defer database.Close()

	rows, err := database.QueryContext(
		ctx,
		`SELECT DISTINCT avatar_file FROM users WHERE avatar_file <> '' ORDER BY avatar_file`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var fileNames []string
	for rows.Next() {
		var fileName string
		if err := rows.Scan(&fileName); err != nil {
			return nil, err
		}
		fileNames = append(fileNames, fileName)
	}
	return fileNames, rows.Err()
}

func reserveTemporaryPath(directory string, pattern string) (string, error) {
	temporary, err := os.CreateTemp(directory, pattern)
	if err != nil {
		return "", err
	}
	path := temporary.Name()
	if err := temporary.Close(); err != nil {
		os.Remove(path)
		return "", err
	}
	if err := os.Remove(path); err != nil {
		return "", err
	}
	return path, nil
}

func copyFileAtomically(sourcePath string, targetPath string, mode os.FileMode) error {
	source, err := os.Open(sourcePath)
	if err != nil {
		return err
	}
	defer source.Close()

	if err := os.MkdirAll(filepath.Dir(targetPath), 0o755); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(targetPath), ".auth-storage-*")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)

	if err := temporary.Chmod(mode); err != nil {
		temporary.Close()
		return err
	}
	if _, err := io.Copy(temporary, source); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(temporaryPath, targetPath)
}
