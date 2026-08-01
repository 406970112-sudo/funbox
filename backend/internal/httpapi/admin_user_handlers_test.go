package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"my-first-expo-app/backend/internal/access"
	"my-first-expo-app/backend/internal/auth"
	"my-first-expo-app/backend/internal/config"
	"my-first-expo-app/backend/internal/roles"
	"my-first-expo-app/backend/internal/social"
	"my-first-expo-app/backend/internal/user"
)

type adminUsersTestPage struct {
	Limit  int                     `json:"limit"`
	Offset int                     `json:"offset"`
	Total  int                     `json:"total"`
	Users  []adminUsersTestSummary `json:"users"`
}

type adminUsersTestSummary struct {
	DisplayName    string     `json:"displayName"`
	ID             string     `json:"id"`
	MaskedUsername string     `json:"maskedUsername"`
	Role           roles.Role `json:"role"`
}

type adminUsersTestDetailEnvelope struct {
	Changed bool                 `json:"changed"`
	User    adminUsersTestDetail `json:"user"`
}

type adminUsersTestDetail struct {
	DisplayName string     `json:"displayName"`
	ID          string     `json:"id"`
	Role        roles.Role `json:"role"`
	Username    string     `json:"username"`
}

type adminUsersTestHistory struct {
	Changes []adminUsersTestChange `json:"changes"`
	Total   int                    `json:"total"`
}

type adminUsersTestChange struct {
	FromRole            roles.Role `json:"fromRole"`
	OperatorDisplayName string     `json:"operatorDisplayName"`
	Reason              string     `json:"reason"`
	ToRole              roles.Role `json:"toRole"`
}

type adminUsersTestFixture struct {
	AdminID     string
	AdminToken  string
	MemberID    string
	MemberToken string
	Server      *httptest.Server
}

func TestAdminUsersRequireAdministrator(t *testing.T) {
	fixture := newAdminUsersTestServer(t)

	requestJSON[map[string]any](
		t,
		fixture.Server.Client(),
		http.MethodGet,
		fixture.Server.URL+"/api/v1/admin/users",
		"",
		"",
		http.StatusUnauthorized,
	)
	response := requestJSON[map[string]string](
		t,
		fixture.Server.Client(),
		http.MethodGet,
		fixture.Server.URL+"/api/v1/admin/users",
		"",
		fixture.MemberToken,
		http.StatusForbidden,
	)
	if response["error"] != "admin_required" {
		t.Fatalf("error = %q", response["error"])
	}
}

func TestAdminUsersListMasksUsernameAndDetailRevealsIt(t *testing.T) {
	fixture := newAdminUsersTestServer(t)

	page := requestJSON[adminUsersTestPage](
		t,
		fixture.Server.Client(),
		http.MethodGet,
		fixture.Server.URL+"/api/v1/admin/users?q=%E5%B0%8F%E6%BB%A1&role=normal&limit=20&offset=0",
		"",
		fixture.AdminToken,
		http.StatusOK,
	)
	if page.Total != 1 || len(page.Users) != 1 {
		t.Fatalf("page = %+v, want one user", page)
	}
	if page.Users[0].ID != fixture.MemberID || page.Users[0].MaskedUsername != "138****0002" {
		t.Fatalf("summary = %+v", page.Users[0])
	}

	detail := requestJSON[adminUsersTestDetailEnvelope](
		t,
		fixture.Server.Client(),
		http.MethodGet,
		fixture.Server.URL+"/api/v1/admin/users/"+fixture.MemberID,
		"",
		fixture.AdminToken,
		http.StatusOK,
	)
	if detail.User.Username != "13800000002" || detail.User.DisplayName != "林小满" {
		t.Fatalf("detail = %+v", detail)
	}
}

func TestAdminUsersUpdateRoleAndReturnAuditHistory(t *testing.T) {
	fixture := newAdminUsersTestServer(t)

	updated := requestJSON[adminUsersTestDetailEnvelope](
		t,
		fixture.Server.Client(),
		http.MethodPatch,
		fixture.Server.URL+"/api/v1/admin/users/"+fixture.MemberID+"/role",
		`{"expectedRole":"normal","role":"vip","reason":"活动赠送权益"}`,
		fixture.AdminToken,
		http.StatusOK,
	)
	if !updated.Changed || updated.User.Role != roles.VIP {
		t.Fatalf("updated = %+v", updated)
	}

	history := requestJSON[adminUsersTestHistory](
		t,
		fixture.Server.Client(),
		http.MethodGet,
		fixture.Server.URL+"/api/v1/admin/users/"+fixture.MemberID+"/role-changes?limit=10&offset=0",
		"",
		fixture.AdminToken,
		http.StatusOK,
	)
	if history.Total != 1 || len(history.Changes) != 1 {
		t.Fatalf("history = %+v", history)
	}
	change := history.Changes[0]
	if change.FromRole != roles.Normal || change.ToRole != roles.VIP ||
		change.Reason != "活动赠送权益" || change.OperatorDisplayName != "管理员" {
		t.Fatalf("change = %+v", change)
	}

	conflict := requestJSON[map[string]string](
		t,
		fixture.Server.Client(),
		http.MethodPatch,
		fixture.Server.URL+"/api/v1/admin/users/"+fixture.MemberID+"/role",
		`{"expectedRole":"normal","role":"svip","reason":"覆盖修改"}`,
		fixture.AdminToken,
		http.StatusConflict,
	)
	if conflict["error"] != "role_changed" {
		t.Fatalf("conflict error = %q", conflict["error"])
	}
}

func TestAdminUsersProtectAdminAndRejectAdminAssignment(t *testing.T) {
	fixture := newAdminUsersTestServer(t)

	protected := requestJSON[map[string]string](
		t,
		fixture.Server.Client(),
		http.MethodPatch,
		fixture.Server.URL+"/api/v1/admin/users/"+fixture.AdminID+"/role",
		`{"expectedRole":"admin","role":"vip","reason":"错误降级"}`,
		fixture.AdminToken,
		http.StatusForbidden,
	)
	if protected["error"] != "protected_admin_role" {
		t.Fatalf("protected error = %q", protected["error"])
	}

	invalid := requestJSON[map[string]string](
		t,
		fixture.Server.Client(),
		http.MethodPatch,
		fixture.Server.URL+"/api/v1/admin/users/"+fixture.MemberID+"/role",
		`{"expectedRole":"normal","role":"admin","reason":"错误提权"}`,
		fixture.AdminToken,
		http.StatusBadRequest,
	)
	if invalid["error"] != "invalid_role" {
		t.Fatalf("invalid error = %q", invalid["error"])
	}
}

func newAdminUsersTestServer(t *testing.T) adminUsersTestFixture {
	t.Helper()
	tempDir := t.TempDir()
	databasePath := filepath.Join(tempDir, "app.db")

	userStore, err := user.OpenStore(databasePath)
	if err != nil {
		t.Fatalf("open user store: %v", err)
	}
	t.Cleanup(func() { _ = userStore.Close() })
	socialStore, err := social.OpenStore(databasePath)
	if err != nil {
		t.Fatalf("open social store: %v", err)
	}
	t.Cleanup(func() { _ = socialStore.Close() })
	accessStore, err := access.OpenStore(databasePath)
	if err != nil {
		t.Fatalf("open access store: %v", err)
	}
	t.Cleanup(func() { _ = accessStore.Close() })

	cfg := config.Config{
		Auth: config.AuthConfig{TokenTTL: time.Hour},
		Server: config.ServerConfig{
			Host:         "127.0.0.1",
			ReadTimeout:  5 * time.Second,
			WriteTimeout: 5 * time.Second,
		},
		Security: config.SecurityConfig{
			MaxRequestBodyBytes: 64 << 10,
			RateLimitMax:        100,
			RateLimitWindow:     time.Minute,
		},
		Storage: config.StorageConfig{
			AvatarDir:      filepath.Join(tempDir, "avatars"),
			MaxAvatarBytes: 1 << 20,
		},
	}
	authService := auth.NewService(userStore, []byte(strings.Repeat("k", 32)), time.Hour)
	httpServer := NewServer(cfg, nil, nil, authService, socialStore, accessStore, nil)
	testServer := httptest.NewServer(httpServer.Handler)
	t.Cleanup(testServer.Close)

	admin := requestJSON[sessionResponse](
		t,
		testServer.Client(),
		http.MethodPost,
		testServer.URL+"/api/v1/auth/register",
		`{"username":"13800000001","password":"password-123","displayName":"管理员","securityQuestion":"你的第一个昵称是什么？","securityAnswer":"小管"}`,
		"",
		http.StatusCreated,
	)
	member := requestJSON[sessionResponse](
		t,
		testServer.Client(),
		http.MethodPost,
		testServer.URL+"/api/v1/auth/register",
		`{"username":"13800000002","password":"password-123","displayName":"林小满","securityQuestion":"你的第一个昵称是什么？","securityAnswer":"小满"}`,
		"",
		http.StatusCreated,
	)
	vip := requestJSON[sessionResponse](
		t,
		testServer.Client(),
		http.MethodPost,
		testServer.URL+"/api/v1/auth/register",
		`{"username":"13800000003","password":"password-123","displayName":"张玲","securityQuestion":"你的第一个昵称是什么？","securityAnswer":"小玲"}`,
		"",
		http.StatusCreated,
	)
	if _, err := userStore.UpdateRoleByUsername(context.Background(), admin.User.Username, roles.Admin); err != nil {
		t.Fatalf("promote admin: %v", err)
	}
	if _, err := userStore.UpdateRoleByUsername(context.Background(), vip.User.Username, roles.VIP); err != nil {
		t.Fatalf("promote vip: %v", err)
	}

	return adminUsersTestFixture{
		AdminID:     admin.User.ID,
		AdminToken:  admin.AccessToken,
		MemberID:    member.User.ID,
		MemberToken: member.AccessToken,
		Server:      testServer,
	}
}
