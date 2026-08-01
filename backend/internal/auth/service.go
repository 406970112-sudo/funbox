package auth

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"

	"my-first-expo-app/backend/internal/roles"
	"my-first-expo-app/backend/internal/user"
)

var (
	ErrCurrentPasswordInvalid  = errors.New("current password is invalid")
	ErrDisplayNameInvalid      = errors.New("display name is invalid")
	ErrInvalidCredentials      = errors.New("invalid credentials")
	ErrPasswordInvalid         = errors.New("password is invalid")
	ErrRecoveryAnswerInvalid   = errors.New("recovery answer is invalid")
	ErrRecoveryLocked          = errors.New("password recovery is locked")
	ErrRecoveryTokenInvalid    = errors.New("recovery token is invalid")
	ErrRecoveryUnavailable     = errors.New("password recovery is unavailable")
	ErrRoleInvalid             = errors.New("role is invalid")
	ErrSecurityAnswerInvalid   = errors.New("security answer is invalid")
	ErrSecurityQuestionInvalid = errors.New("security question is invalid")
	ErrTokenInvalid            = errors.New("token is invalid")
	ErrUsernameInvalid         = errors.New("username is invalid")
	ErrUsernameTaken           = user.ErrUsernameTaken
)

const (
	maxRecoveryAttempts     = 5
	maxSecurityAnswerLength = 64
	recoveryLockDuration    = 30 * time.Minute
	recoveryTokenTTL        = 10 * time.Minute
)

var usernamePattern = regexp.MustCompile(`^1[3-9][0-9]{9}$`)

type Store interface {
	Create(context.Context, string, string, string, string, string) (user.User, error)
	GetByID(context.Context, string) (user.User, error)
	GetByUsername(context.Context, string) (user.User, error)
	List(context.Context, user.ListOptions) (user.ListResult, error)
	ListRoleChangesByUserID(context.Context, string, int, int) (user.RoleChangeListResult, error)
	UpdateAvatar(context.Context, string, string) (user.User, string, error)
	UpdateDisplayName(context.Context, string, string) (user.User, error)
	UpdatePasswordHash(context.Context, string, string) (user.User, error)
	UpdateRecoveryState(context.Context, string, int, time.Time) error
	UpdateRole(context.Context, string, string, roles.Role, roles.Role, string) (user.User, bool, error)
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

type recoveryClaims struct {
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
	securityQuestion string,
	securityAnswer string,
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
	normalizedQuestion, err := validateSecurityQuestion(securityQuestion)
	if err != nil {
		return Session{}, err
	}
	normalizedAnswer, err := normalizeSecurityAnswer(securityAnswer)
	if err != nil {
		return Session{}, err
	}

	passwordHash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return Session{}, fmt.Errorf("hash password: %w", err)
	}
	securityAnswerHash, err := bcrypt.GenerateFromPassword(
		securityAnswerDigest(normalizedAnswer),
		bcrypt.DefaultCost,
	)
	if err != nil {
		return Session{}, fmt.Errorf("hash security answer: %w", err)
	}

	created, err := s.store.Create(
		ctx,
		normalizedUsername,
		string(passwordHash),
		normalizedDisplayName,
		normalizedQuestion,
		string(securityAnswerHash),
	)
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

func (s *Service) PasswordRecoveryQuestion(ctx context.Context, username string) (string, error) {
	found, err := s.recoveryAccount(ctx, username)
	if err != nil {
		return "", err
	}
	if time.Now().UTC().Before(found.RecoveryLockedUntil) {
		return "", ErrRecoveryLocked
	}
	return found.SecurityQuestion, nil
}

func (s *Service) VerifyRecoveryAnswer(
	ctx context.Context,
	username string,
	securityAnswer string,
) (string, error) {
	found, err := s.recoveryAccount(ctx, username)
	if err != nil {
		return "", err
	}

	now := time.Now().UTC()
	if now.Before(found.RecoveryLockedUntil) {
		return "", ErrRecoveryLocked
	}
	normalizedAnswer, err := normalizeSecurityAnswer(securityAnswer)
	if err != nil {
		return "", err
	}
	if !securityAnswerMatches(found.SecurityAnswerHash, normalizedAnswer) {
		failedAttempts := found.RecoveryFailedAttempts + 1
		lockedUntil := time.Time{}
		resultErr := ErrRecoveryAnswerInvalid
		if failedAttempts >= maxRecoveryAttempts {
			failedAttempts = 0
			lockedUntil = now.Add(recoveryLockDuration)
			resultErr = ErrRecoveryLocked
		}
		if err := s.store.UpdateRecoveryState(
			ctx,
			found.ID,
			failedAttempts,
			lockedUntil,
		); err != nil {
			return "", err
		}
		return "", resultErr
	}

	if found.RecoveryFailedAttempts != 0 || !found.RecoveryLockedUntil.IsZero() {
		if err := s.store.UpdateRecoveryState(ctx, found.ID, 0, time.Time{}); err != nil {
			return "", err
		}
	}
	return s.recoveryTokenForUser(found)
}

func (s *Service) ResetPasswordWithRecoveryToken(
	ctx context.Context,
	rawToken string,
	newPassword string,
) error {
	if err := validatePassword(newPassword); err != nil {
		return err
	}

	claims := &recoveryClaims{}
	token, err := jwt.ParseWithClaims(
		rawToken,
		claims,
		func(token *jwt.Token) (any, error) {
			return s.signingKey, nil
		},
		jwt.WithAudience("password-reset"),
		jwt.WithIssuer(s.issuer+"-password-recovery"),
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
	)
	if err != nil || !token.Valid || claims.Subject == "" {
		return ErrRecoveryTokenInvalid
	}

	found, err := s.store.GetByID(ctx, claims.Subject)
	if err != nil || found.TokenVersion != claims.TokenVersion {
		return ErrRecoveryTokenInvalid
	}
	passwordHash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("hash recovered password: %w", err)
	}
	if _, err := s.store.UpdatePasswordHash(ctx, found.ID, string(passwordHash)); err != nil {
		return err
	}
	return nil
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

func (s *Service) ListUsers(ctx context.Context, options user.ListOptions) (user.ListResult, error) {
	return s.store.List(ctx, options)
}

func (s *Service) GetUserByID(ctx context.Context, userID string) (user.User, error) {
	return s.store.GetByID(ctx, userID)
}

func (s *Service) UpdateUserRole(
	ctx context.Context,
	targetUserID string,
	operatorUserID string,
	expectedRole roles.Role,
	nextRole roles.Role,
	reason string,
) (user.User, bool, error) {
	if !roles.IsValid(expectedRole) || !isAssignableUserRole(nextRole) {
		return user.User{}, false, ErrRoleInvalid
	}
	return s.store.UpdateRole(
		ctx,
		targetUserID,
		operatorUserID,
		expectedRole,
		nextRole,
		strings.TrimSpace(reason),
	)
}

func (s *Service) ListUserRoleChanges(
	ctx context.Context,
	targetUserID string,
	limit int,
	offset int,
) (user.RoleChangeListResult, error) {
	return s.store.ListRoleChangesByUserID(ctx, targetUserID, limit, offset)
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

func (s *Service) recoveryAccount(ctx context.Context, username string) (user.User, error) {
	normalizedUsername, err := validateUsername(username)
	if err != nil {
		return user.User{}, err
	}
	found, err := s.store.GetByUsername(ctx, normalizedUsername)
	if err != nil {
		if errors.Is(err, user.ErrNotFound) {
			return user.User{}, ErrRecoveryUnavailable
		}
		return user.User{}, err
	}
	if found.SecurityQuestion == "" || found.SecurityAnswerHash == "" {
		return user.User{}, ErrRecoveryUnavailable
	}
	return found, nil
}

func (s *Service) recoveryTokenForUser(account user.User) (string, error) {
	now := time.Now().UTC()
	claims := recoveryClaims{
		TokenVersion: account.TokenVersion,
		RegisteredClaims: jwt.RegisteredClaims{
			Audience:  jwt.ClaimStrings{"password-reset"},
			ExpiresAt: jwt.NewNumericDate(now.Add(recoveryTokenTTL)),
			IssuedAt:  jwt.NewNumericDate(now),
			Issuer:    s.issuer + "-password-recovery",
			Subject:   account.ID,
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString(s.signingKey)
	if err != nil {
		return "", fmt.Errorf("sign recovery token: %w", err)
	}
	return signed, nil
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
	hasLetter := false
	hasNumber := false
	for _, character := range value {
		if unicode.IsControl(character) {
			return ErrPasswordInvalid
		}
		hasLetter = hasLetter || unicode.IsLetter(character)
		hasNumber = hasNumber || unicode.IsDigit(character)
	}
	if !hasLetter || !hasNumber {
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

func validateSecurityQuestion(value string) (string, error) {
	normalized := strings.TrimSpace(value)
	length := utf8.RuneCountInString(normalized)
	if length < 4 || length > 64 {
		return "", ErrSecurityQuestionInvalid
	}
	for _, character := range normalized {
		if unicode.IsControl(character) {
			return "", ErrSecurityQuestionInvalid
		}
	}
	return normalized, nil
}

func normalizeSecurityAnswer(value string) (string, error) {
	normalized := strings.ToLower(strings.TrimSpace(value))
	length := utf8.RuneCountInString(normalized)
	if length < 1 || length > maxSecurityAnswerLength {
		return "", ErrSecurityAnswerInvalid
	}
	for _, character := range normalized {
		if unicode.IsControl(character) {
			return "", ErrSecurityAnswerInvalid
		}
	}
	return normalized, nil
}

func securityAnswerDigest(normalizedAnswer string) []byte {
	digest := sha256.Sum256([]byte(normalizedAnswer))
	return digest[:]
}

func securityAnswerMatches(answerHash string, normalizedAnswer string) bool {
	hash := []byte(answerHash)
	if bcrypt.CompareHashAndPassword(hash, securityAnswerDigest(normalizedAnswer)) == nil {
		return true
	}
	// Accounts created before answers were pre-hashed stored the normalized answer directly.
	return bcrypt.CompareHashAndPassword(hash, []byte(normalizedAnswer)) == nil
}

func isAssignableUserRole(role roles.Role) bool {
	return role == roles.Normal || role == roles.VIP || role == roles.SVIP
}
