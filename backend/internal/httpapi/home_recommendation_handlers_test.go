package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"my-first-expo-app/backend/internal/access"
	"my-first-expo-app/backend/internal/auth"
	"my-first-expo-app/backend/internal/config"
	"my-first-expo-app/backend/internal/homerecommendation"
	"my-first-expo-app/backend/internal/roles"
	"my-first-expo-app/backend/internal/social"
	"my-first-expo-app/backend/internal/user"
)

func TestHomeRecommendationRoutes(t *testing.T) {
	fixture := newHomeRecommendationHTTPTestServer(t)

	fallback := fixture.request(t, "GET", "/api/v1/home/recommendations", "", "")
	fallbackBody, err := io.ReadAll(fallback.Body)
	fallback.Body.Close()
	if err != nil {
		t.Fatal(err)
	}
	if fallback.StatusCode != http.StatusOK {
		t.Fatalf("fallback status = %d", fallback.StatusCode)
	}
	var fallbackEnvelope struct {
		Source string `json:"source"`
		Items  []struct {
			FeatureID string `json:"featureId"`
			Route     string `json:"route"`
		} `json:"items"`
	}
	if err := json.Unmarshal(fallbackBody, &fallbackEnvelope); err != nil {
		t.Fatal(err)
	}
	if fallbackEnvelope.Source != "fallback" ||
		len(fallbackEnvelope.Items) != 1 ||
		fallbackEnvelope.Items[0].FeatureID != homerecommendation.DefaultFallbackFeatureID {
		t.Fatalf("fallback = %s", fallbackBody)
	}

	adminList := fixture.request(t, "GET", "/api/v1/admin/home-recommendations", fixture.AdminToken, "")
	adminList.Body.Close()
	if adminList.StatusCode != http.StatusOK {
		t.Fatalf("admin list status = %d", adminList.StatusCode)
	}
	forbidden := fixture.request(t, "GET", "/api/v1/admin/home-recommendations", fixture.NormalToken, "")
	forbidden.Body.Close()
	if forbidden.StatusCode != http.StatusForbidden {
		t.Fatalf("normal user admin list status = %d", forbidden.StatusCode)
	}

	created := fixture.request(t, "POST", "/api/v1/admin/home-recommendations", fixture.AdminToken, `{
		"slot": {"featureId": "smart-translation", "enabled": true}
	}`)
	createdBody, err := io.ReadAll(created.Body)
	created.Body.Close()
	if err != nil {
		t.Fatal(err)
	}
	if created.StatusCode != http.StatusCreated {
		t.Fatalf("create status = %d body = %s", created.StatusCode, createdBody)
	}
	var createdEnvelope struct {
		Slot struct {
			ID          string `json:"id"`
			FeatureID   string `json:"featureId"`
			FeatureKind string `json:"featureKind"`
		} `json:"slot"`
	}
	if err := json.Unmarshal(createdBody, &createdEnvelope); err != nil {
		t.Fatal(err)
	}
	slotID := createdEnvelope.Slot.ID
	if slotID == "" || createdEnvelope.Slot.FeatureKind != "tool" {
		t.Fatalf("created = %s", createdBody)
	}

	configured := fixture.request(t, "GET", "/api/v1/home/recommendations", "", "")
	configuredBody, _ := io.ReadAll(configured.Body)
	configured.Body.Close()
	if configured.StatusCode != http.StatusOK || !strings.Contains(string(configuredBody), `"smart-translation"`) {
		t.Fatalf("configured = %s", configuredBody)
	}

	badFeature := fixture.request(t, "POST", "/api/v1/admin/home-recommendations", fixture.AdminToken, `{
		"slot": {"featureId": "not-exists", "enabled": true}
	}`)
	badFeature.Body.Close()
	if badFeature.StatusCode != http.StatusBadRequest {
		t.Fatalf("bad feature status = %d", badFeature.StatusCode)
	}

	deleteResponse := fixture.request(t, "DELETE", "/api/v1/admin/home-recommendations/"+slotID, fixture.AdminToken, "")
	deleteResponse.Body.Close()
	if deleteResponse.StatusCode != http.StatusConflict {
		t.Fatalf("delete last slot status = %d", deleteResponse.StatusCode)
	}

	event := fixture.request(t, "POST", "/api/v1/home/recommendations/events", fixture.NormalToken, `{
		"eventType": "view", "slotId": "`+slotID+`"
	}`)
	event.Body.Close()
	if event.StatusCode != http.StatusOK {
		t.Fatalf("event status = %d", event.StatusCode)
	}
	event = fixture.request(t, "POST", "/api/v1/home/recommendations/events", fixture.NormalToken, `{
		"eventType": "view", "slotId": "`+slotID+`"
	}`)
	event.Body.Close()
	event = fixture.request(t, "POST", "/api/v1/home/recommendations/events", fixture.NormalToken, `{
		"eventType": "click", "slotId": "`+slotID+`"
	}`)
	event.Body.Close()

	stats := fixture.request(t, "GET", "/api/v1/admin/home-recommendations/stats", fixture.AdminToken, "")
	statsBody, _ := io.ReadAll(stats.Body)
	stats.Body.Close()
	if stats.StatusCode != http.StatusOK || !strings.Contains(string(statsBody), `"views":1`) ||
		!strings.Contains(string(statsBody), `"clicks":1`) ||
		!strings.Contains(string(statsBody), `"featureId":"smart-translation"`) {
		t.Fatalf("stats = %s", statsBody)
	}

	audit := fixture.request(t, "GET", "/api/v1/admin/home-recommendations/audit-log", fixture.AdminToken, "")
	auditBody, _ := io.ReadAll(audit.Body)
	audit.Body.Close()
	if audit.StatusCode != http.StatusOK || !strings.Contains(string(auditBody), `"create"`) {
		t.Fatalf("audit = %s", auditBody)
	}
}

func TestHomeRecommendationReorder(t *testing.T) {
	fixture := newHomeRecommendationHTTPTestServer(t)
	create := func(featureID string) string {
		response := fixture.request(t, "POST", "/api/v1/admin/home-recommendations", fixture.AdminToken,
			`{"slot":{"featureId":"`+featureID+`","enabled":true}}`)
		body, _ := io.ReadAll(response.Body)
		response.Body.Close()
		if response.StatusCode != http.StatusCreated {
			t.Fatalf("create %s status = %d", featureID, response.StatusCode)
		}
		var envelope struct {
			Slot struct {
				ID string `json:"id"`
			} `json:"slot"`
		}
		if err := json.Unmarshal(body, &envelope); err != nil {
			t.Fatal(err)
		}
		return envelope.Slot.ID
	}
	first := create("card-score")
	second := create("qr-code")

	response := fixture.request(t, "PUT", "/api/v1/admin/home-recommendations/reorder", fixture.AdminToken,
		`{"slotIds":["`+second+`","`+first+`"]}`)
	response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("reorder status = %d", response.StatusCode)
	}

	configured := fixture.request(t, "GET", "/api/v1/home/recommendations", "", "")
	body, _ := io.ReadAll(configured.Body)
	configured.Body.Close()
	var envelope struct {
		Items []struct {
			FeatureID string `json:"featureId"`
		} `json:"items"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		t.Fatal(err)
	}
	if len(envelope.Items) < 2 || envelope.Items[0].FeatureID != "qr-code" {
		t.Fatalf("reorder result = %s", body)
	}
}

type homeRecommendationHTTPTestFixture struct {
	Server      *httptest.Server
	AdminToken  string
	NormalToken string
}

func (f *homeRecommendationHTTPTestFixture) request(
	t *testing.T,
	method string,
	path string,
	token string,
	body string,
) *http.Response {
	t.Helper()
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	request, err := http.NewRequest(method, f.Server.URL+path, reader)
	if err != nil {
		t.Fatal(err)
	}
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := f.Server.Client().Do(request)
	if err != nil {
		t.Fatal(err)
	}
	return response
}

func newHomeRecommendationHTTPTestServer(t *testing.T) *homeRecommendationHTTPTestFixture {
	t.Helper()
	tempDir := t.TempDir()
	databasePath := filepath.Join(tempDir, "app.db")

	userStore, err := user.OpenStore(databasePath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = userStore.Close() })
	socialStore, err := social.OpenStore(databasePath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = socialStore.Close() })
	accessStore, err := access.OpenStore(databasePath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = accessStore.Close() })
	homeStore, err := homerecommendation.OpenStore(databasePath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = homeStore.Close() })
	homeService, err := homerecommendation.NewService(homeStore)
	if err != nil {
		t.Fatal(err)
	}
	registry, err := access.Registry()
	if err != nil {
		t.Fatal(err)
	}
	if err := accessStore.SyncRegistry(context.Background(), registry); err != nil {
		t.Fatal(err)
	}

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
			AvatarDir: filepath.Join(tempDir, "avatars"),
		},
	}
	authService := auth.NewService(userStore, []byte(strings.Repeat("k", 32)), time.Hour)
	httpServer := NewServerWithHomeRecommendation(
		cfg,
		nil,
		nil,
		authService,
		socialStore,
		accessStore,
		homeService,
	)
	testServer := httptest.NewServer(httpServer.Handler)
	t.Cleanup(testServer.Close)

	normal := requestJSON[sessionResponse](
		t,
		testServer.Client(),
		http.MethodPost,
		testServer.URL+"/api/v1/auth/register",
		`{"username":"13800138000","password":"password-123","displayName":"普通用户","securityQuestion":"你的第一个绰号是什么？","securityAnswer":"小布同学"}`,
		"",
		http.StatusCreated,
	)
	admin := requestJSON[sessionResponse](
		t,
		testServer.Client(),
		http.MethodPost,
		testServer.URL+"/api/v1/auth/register",
		`{"username":"13900139000","password":"password-123","displayName":"管理员","securityQuestion":"你的第一个绰号是什么？","securityAnswer":"小管"}`,
		"",
		http.StatusCreated,
	)
	if _, err := userStore.UpdateRoleByUsername(context.Background(), admin.User.Username, roles.Admin); err != nil {
		t.Fatal(err)
	}
	return &homeRecommendationHTTPTestFixture{
		Server:      testServer,
		AdminToken:  admin.AccessToken,
		NormalToken: normal.AccessToken,
	}
}
