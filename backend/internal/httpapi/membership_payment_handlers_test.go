package httpapi

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"my-first-expo-app/backend/internal/access"
	"my-first-expo-app/backend/internal/auth"
	"my-first-expo-app/backend/internal/config"
	"my-first-expo-app/backend/internal/membership"
	"my-first-expo-app/backend/internal/roles"
	"my-first-expo-app/backend/internal/social"
	"my-first-expo-app/backend/internal/user"
)

type membershipTestSettingsEnvelope struct {
	Settings membershipTestSettings `json:"settings"`
}

type membershipTestSettings struct {
	Enabled        bool   `json:"enabled"`
	QrURL          string `json:"qrUrl"`
	Note           string `json:"note"`
	VIPPriceCents  int    `json:"vipPriceCents"`
	SVIPPriceCents int    `json:"svipPriceCents"`
	UpdatedByName  string `json:"updatedByName"`
}

type membershipTestPaymentInfo struct {
	Enabled bool `json:"enabled"`
	QrURL   string `json:"qrUrl"`
	Note    string `json:"note"`
	Plans   []struct {
		Tier       string `json:"tier"`
		PriceCents int    `json:"priceCents"`
		Period     string `json:"period"`
	} `json:"plans"`
}

type membershipTestAdminPage struct {
	Changes []struct {
		Action              string `json:"action"`
		Detail              string `json:"detail"`
		OperatorDisplayName string `json:"operatorDisplayName"`
	} `json:"changes"`
	Settings membershipTestSettings `json:"settings"`
	Total    int                    `json:"total"`
}

type membershipTestFixture struct {
	AdminID     string
	AdminToken  string
	MemberToken string
	Server      *httptest.Server
}

const tinyPNGBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC"

func TestMembershipPaymentEndpointsRequireAuthAndAdmin(t *testing.T) {
	fixture := newMembershipTestServer(t)

	requestJSON[map[string]any](
		t,
		fixture.Server.Client(),
		http.MethodGet,
		fixture.Server.URL+"/api/v1/membership/payment",
		"",
		"",
		http.StatusUnauthorized,
	)
	response := requestJSON[map[string]string](
		t,
		fixture.Server.Client(),
		http.MethodGet,
		fixture.Server.URL+"/api/v1/admin/membership/settings",
		"",
		fixture.MemberToken,
		http.StatusForbidden,
	)
	if response["error"] != "admin_required" {
		t.Fatalf("error = %q", response["error"])
	}
}

func TestMembershipPaymentQRUploadServesAndReturnsInfo(t *testing.T) {
	fixture := newMembershipTestServer(t)

	uploaded := uploadMembershipQR(t, fixture.Server.Client(), fixture.Server.URL+"/api/v1/admin/membership/payment/qr", fixture.AdminToken)
	if !uploaded.Settings.Enabled || uploaded.Settings.QrURL == "" {
		t.Fatalf("uploaded settings = %+v", uploaded.Settings)
	}

	fileName := strings.TrimPrefix(uploaded.Settings.QrURL, "/payment-qr/")
	response, err := fixture.Server.Client().Get(fixture.Server.URL + "/payment-qr/" + fileName)
	if err != nil {
		t.Fatalf("fetch payment qr: %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("payment qr status = %d", response.StatusCode)
	}

	info := requestJSON[membershipTestPaymentInfo](
		t,
		fixture.Server.Client(),
		http.MethodGet,
		fixture.Server.URL+"/api/v1/membership/payment",
		"",
		fixture.MemberToken,
		http.StatusOK,
	)
	if !info.Enabled || info.QrURL == "" || len(info.Plans) != 2 {
		t.Fatalf("payment info = %+v", info)
	}
	if info.Plans[0].Tier != "vip" || info.Plans[0].PriceCents != 200 ||
		info.Plans[1].Tier != "svip" || info.Plans[1].PriceCents != 500 {
		t.Fatalf("plans = %+v", info.Plans)
	}
}

func TestMembershipPaymentQRRejectsInvalidImage(t *testing.T) {
	fixture := newMembershipTestServer(t)
	response := requestMultipart(t, fixture.Server.Client(), fixture.Server.URL+"/api/v1/admin/membership/payment/qr", fixture.AdminToken, []byte("not-an-image"))
	if response.StatusCode != http.StatusUnsupportedMediaType {
		t.Fatalf("status = %d, want 415", response.StatusCode)
	}
	response.Body.Close()
}

func TestMembershipPaymentNoteAndRemove(t *testing.T) {
	fixture := newMembershipTestServer(t)

	uploaded := uploadMembershipQR(t, fixture.Server.Client(), fixture.Server.URL+"/api/v1/admin/membership/payment/qr", fixture.AdminToken)
	if !uploaded.Settings.Enabled {
		t.Fatal("qr must be enabled after upload")
	}

	noted := requestJSON[membershipTestSettingsEnvelope](
		t,
		fixture.Server.Client(),
		http.MethodPut,
		fixture.Server.URL+"/api/v1/admin/membership/payment/note",
		`{"note":"转账请备注注册手机号"}`, 
		fixture.AdminToken,
		http.StatusOK,
	)
	if noted.Settings.Note != "转账请备注注册手机号" {
		t.Fatalf("note = %q", noted.Settings.Note)
	}

	removed := requestJSON[membershipTestSettingsEnvelope](
		t,
		fixture.Server.Client(),
		http.MethodDelete,
		fixture.Server.URL+"/api/v1/admin/membership/payment/qr",
		"",
		fixture.AdminToken,
		http.StatusOK,
	)
	if removed.Settings.Enabled {
		t.Fatal("qr must be disabled after remove")
	}

	page := requestJSON[membershipTestAdminPage](
		t,
		fixture.Server.Client(),
		http.MethodGet,
		fixture.Server.URL+"/api/v1/admin/membership/settings",
		"",
		fixture.AdminToken,
		http.StatusOK,
	)
	if page.Total != 3 || len(page.Changes) != 3 {
		t.Fatalf("changes = %+v", page)
	}
	if page.Changes[0].Action != "qr_remove" || page.Changes[0].OperatorDisplayName == "" {
		t.Fatalf("first change = %+v", page.Changes[0])
	}
}

func newMembershipTestServer(t *testing.T) membershipTestFixture {
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
	membershipStore, err := membership.OpenStore(databasePath)
	if err != nil {
		t.Fatalf("open membership store: %v", err)
	}
	t.Cleanup(func() { _ = membershipStore.Close() })

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
			AvatarDir:           filepath.Join(tempDir, "avatars"),
			MaxAvatarBytes:      1 << 20,
			PaymentQRDir:        filepath.Join(tempDir, "payment-qr"),
			MaxPaymentQRBytes:   2 << 20,
		},
	}
	authService := auth.NewService(userStore, []byte(strings.Repeat("k", 32)), time.Hour)
	membershipService := membership.NewService(membershipStore, cfg.Storage.PaymentQRDir, cfg.Storage.MaxPaymentQRBytes)
	httpServer := NewServerWithMembership(
		cfg,
		nil,
		nil,
		authService,
		socialStore,
		accessStore,
		nil,
		nil,
		nil,
		nil,
		membershipService,
	)
	testServer := httptest.NewServer(httpServer.Handler)
	t.Cleanup(testServer.Close)

	admin := requestJSON[sessionResponse](
		t,
		testServer.Client(),
		http.MethodPost,
		testServer.URL+"/api/v1/auth/register",
		`{"username":"13800000001","password":"password-123","displayName":"Admin One","securityQuestion":"你的第一个昵称是什么？","securityAnswer":"admin"}`, 
		"",
		http.StatusCreated,
	)
	if _, err := userStore.UpdateRoleByUsername(
		context.Background(),
		admin.User.Username,
		roles.Admin,
	); err != nil {
		t.Fatalf("promote admin: %v", err)
	}
	member := requestJSON[sessionResponse](
		t,
		testServer.Client(),
		http.MethodPost,
		testServer.URL+"/api/v1/auth/register",
		`{"username":"13800000002","password":"password-123","displayName":"Member One","securityQuestion":"你的第一个昵称是什么？","securityAnswer":"member"}`, 
		"",
		http.StatusCreated,
	)

	return membershipTestFixture{
		AdminID:     admin.User.ID,
		AdminToken:  admin.AccessToken,
		MemberToken: member.AccessToken,
		Server:      testServer,
	}
}

func uploadMembershipQR(
	t *testing.T,
	client *http.Client,
	url string,
	token string,
) membershipTestSettingsEnvelope {
	t.Helper()
	response := requestMultipart(t, client, url, token, decodeTinyPNG(t))
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("upload status = %d", response.StatusCode)
	}
	return decodeJSONEnvelope[membershipTestSettingsEnvelope](t, response)
}

func requestMultipart(
	t *testing.T,
	client *http.Client,
	url string,
	token string,
	contents []byte,
) *http.Response {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("qr", "payment-qr.png")
	if err != nil {
		t.Fatalf("create multipart field: %v", err)
	}
	if _, err := part.Write(contents); err != nil {
		t.Fatalf("write multipart field: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}
	request, err := http.NewRequest(http.MethodPost, url, &body)
	if err != nil {
		t.Fatalf("create upload request: %v", err)
	}
	request.Header.Set("Content-Type", writer.FormDataContentType())
	request.Header.Set("Authorization", "Bearer "+token)
	response, err := client.Do(request)
	if err != nil {
		t.Fatalf("send upload request: %v", err)
	}
	return response
}

func decodeTinyPNG(t *testing.T) []byte {
	t.Helper()
	contents, err := base64.StdEncoding.DecodeString(tinyPNGBase64)
	if err != nil {
		t.Fatalf("decode tiny png: %v", err)
	}
	return contents
}

func decodeJSONEnvelope[T any](t *testing.T, response *http.Response) T {
	t.Helper()
	var value T
	if err := json.NewDecoder(response.Body).Decode(&value); err != nil {
		t.Fatalf("decode json envelope: %v", err)
	}
	return value
}
