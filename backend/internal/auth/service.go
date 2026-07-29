package auth

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"

	"my-first-expo-app/backend/internal/user"
)

var (
	ErrCurrentPasswordInvalid = errors.New("current password is invalid")
	ErrDisplayNameInvalid     = errors.New("display name is invalid")
	ErrInvalidCredentials     = errors.New("invalid credentials")
	ErrPasswordInvalid        = errors.New("password is invalid")
	ErrTokenInvalid           = errors.New("token is invalid")
	ErrUsernameInvalid        = errors.New("username is invalid")
	ErrUsernameTaken          = user.ErrUsernameTaken
)

var usernamePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{2,31}$`)

type Store interface {
	Create(context.Context, string, string, string) (user.User, error)
	GetByID(context.Context, string) (user.User, error)
	GetByUsername(context.Context, string) (user.User, error)
	UpdateAvatar(context.Context, string, string) (user.User, string, error)
	UpdateDisplayName(context.Context, string, string) (user.User, error)
	UpdatePasswordHash(context.Context, string, string) (user.User, error)
}

type Service struct {
	issuer     string
	signingKey []byte
	store      Store
	tokenTTL   time.Duration
}

type Session struct {
	AccessToken string
	User        user.User
}

type tokenClaims struct {
	TokenVersion int `json:"ver"`
	jwt.RegisteredClaims
}

func NewService(store Store, signingKey []byte, tokenTTL time.Duration) *Service {
	return &Service{
		issuer:     "funbox-api",
		signingKey: signingKey,
		store:      store,
		tokenTTL:   tokenTTL,
	}
}

func (s *Service) Register(
	ctx context.Context,
	username string,
	password string,
	displayName string,
) (Session, error) {
	normalizedUsername, err := validateUsername(username)
	if err != nil {
		return Session{}, err
	}
	if err := validatePassword(password); err != nil {
		return Session{}, err
	}

	normalizedDisplayName, err := validateDisplayName(displayName)
	if err != nil {
		return Session{}, err
	}

	passwordHash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return Session{}, fmt.Errorf("hash password: %w", err)
	}

	created, err := s.store.Create(ctx, normalizedUsername, string(passwordHash), normalizedDisplayName)
	if err != nil {
		return Session{}, err
	}
	return s.sessionForUser(created)
}

func (s *Service) Login(ctx context.Context, username string, password string) (Session, error) {
	normalizedUsername := strings.ToLower(strings.TrimSpace(username))
	found, err := s.store.GetByUsername(ctx, normalizedUsername)
	if err != nil {
		if errors.Is(err, user.ErrNotFound) {
			return Session{}, ErrInvalidCredentials
		}
		return Session{}, err
	}

	if bcrypt.CompareHashAndPassword([]byte(found.PasswordHash), []byte(password)) != nil {
		return Session{}, ErrInvalidCredentials
	}
	return s.sessionForUser(found)
}

func (s *Service) AuthenticateToken(ctx context.Context, rawToken string) (user.User, error) {
	claims := &tokenClaims{}
	token, err := jwt.ParseWithClaims(
		rawToken,
		claims,
		func(token *jwt.Token) (any, error) {
			return s.signingKey, nil
		},
		jwt.WithIssuer(s.issuer),
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
	)
	if err != nil || !token.Valid || claims.Subject == "" {
		return user.User{}, ErrTokenInvalid
	}

	found, err := s.store.GetByID(ctx, claims.Subject)
	if err != nil || found.TokenVersion != claims.TokenVersion {
		return user.User{}, ErrTokenInvalid
	}
	return found, nil
}

func (s *Service) UpdateDisplayName(
	ctx context.Context,
	userID string,
	displayName string,
) (user.User, error) {
	normalized, err := validateDisplayName(displayName)
	if err != nil {
		return user.User{}, err
	}
	return s.store.UpdateDisplayName(ctx, userID, normalized)
}

func (s *Service) UpdateAvatar(
	ctx context.Context,
	userID string,
	avatarFile string,
) (user.User, string, error) {
	return s.store.UpdateAvatar(ctx, userID, avatarFile)
}

func (s *Service) ChangePassword(
	ctx context.Context,
	userID string,
	currentPassword string,
	newPassword string,
) (Session, error) {
	if err := validatePassword(newPassword); err != nil {
		return Session{}, err
	}

	found, err := s.store.GetByID(ctx, userID)
	if err != nil {
		return Session{}, err
	}
	if bcrypt.CompareHashAndPassword([]byte(found.PasswordHash), []byte(currentPassword)) != nil {
		return Session{}, ErrCurrentPasswordInvalid
	}

	passwordHash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return Session{}, fmt.Errorf("hash password: %w", err)
	}

	updated, err := s.store.UpdatePasswordHash(ctx, userID, string(passwordHash))
	if err != nil {
		return Session{}, err
	}
	return s.sessionForUser(updated)
}

func (s *Service) sessionForUser(account user.User) (Session, error) {
	now := time.Now().UTC()
	claims := tokenClaims{
		TokenVersion: account.TokenVersion,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(now.Add(s.tokenTTL)),
			IssuedAt:  jwt.NewNumericDate(now),
			Issuer:    s.issuer,
			Subject:   account.ID,
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString(s.signingKey)
	if err != nil {
		return Session{}, fmt.Errorf("sign token: %w", err)
	}

	return Session{AccessToken: signed, User: account}, nil
}

func validateUsername(value string) (string, error) {
	normalized := strings.ToLower(strings.TrimSpace(value))
	if !usernamePattern.MatchString(normalized) {
		return "", ErrUsernameInvalid
	}
	return normalized, nil
}

func validatePassword(value string) error {
	if utf8.RuneCountInString(value) < 8 || len([]byte(value)) > 72 {
		return ErrPasswordInvalid
	}
	return nil
}

func validateDisplayName(value string) (string, error) {
	normalized := strings.TrimSpace(value)
	length := utf8.RuneCountInString(normalized)
	if length < 1 || length > 32 {
		return "", ErrDisplayNameInvalid
	}
	for _, character := range normalized {
		if unicode.IsControl(character) {
			return "", ErrDisplayNameInvalid
		}
	}
	return normalized, nil
}
