package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"my-first-expo-app/backend/internal/miniadmin"
)

func TestMiniAdminRequiresSeparateAuthorization(t *testing.T) {
	fixture := newAdminUsersTestServer(t)
	client := fixture.Server.Client()
	root := fixture.Server.URL + "/api/v1/mini-admin"
	requestJSON[map[string]any](t, client, http.MethodGet, root+"/session", "", "", http.StatusUnauthorized)
	for _, token := range []string{fixture.AdminToken, fixture.MemberToken} {
		session := requestJSON[struct {
			Owner       bool
			Permissions []string
		}](t, client, http.MethodGet, root+"/session", "", token, http.StatusOK)
		if session.Owner || len(session.Permissions) != 0 {
			t.Fatalf("unexpected mini-program permissions: %+v", session)
		}
		requestJSON[map[string]any](t, client, http.MethodGet, root+"/users", "", token, http.StatusForbidden)
	}
}

func TestMiniAdminGrantsAreScopedAndRevocable(t *testing.T) {
	fixture := newAdminUsersTestServer(t)
	client, root := fixture.Server.Client(), fixture.Server.URL+"/api/v1"
	if err := fixture.Store.MiniAdmin().BootstrapOwner(context.Background(), fixture.MemberID); err != nil {
		t.Fatal(err)
	}
	requestJSON[map[string]any](t, client, http.MethodGet, root+"/admin/users", "", fixture.MemberToken, http.StatusForbidden)
	requestJSON[map[string]any](t, client, http.MethodPut, root+"/mini-admin/grants/"+fixture.MemberID, `{"permissions":[]}`, fixture.MemberToken, http.StatusForbidden)
	requestJSON[map[string]any](t, client, http.MethodPut, root+"/mini-admin/grants/"+fixture.VIPID, `{"permissions":["users.role","feedback.manage"]}`, fixture.MemberToken, http.StatusOK)
	page := requestJSON[adminUsersTestPage](t, client, http.MethodGet, root+"/mini-admin/users?q="+fixture.AdminID, "", fixture.VIPToken, http.StatusOK)
	if page.Total != 1 || page.Users[0].ID != fixture.AdminID {
		t.Fatalf("exact search did not find account: %+v", page)
	}
	requestJSON[map[string]any](t, client, http.MethodGet, root+"/mini-admin/grants", "", fixture.VIPToken, http.StatusForbidden)
	requestJSON[map[string]any](t, client, http.MethodPut, root+"/mini-admin/users/"+fixture.MemberID+"/role",
		`{"expectedRole":"normal","role":"svip","reason":"运营测试"}`, fixture.VIPToken, http.StatusOK)
	requestJSON[map[string]any](t, client, http.MethodPut, root+"/mini-admin/grants/"+fixture.VIPID, `{"permissions":[]}`, fixture.MemberToken, http.StatusOK)
	current := requestJSON[struct{ Grant miniadmin.Grant }](t, client, http.MethodGet, root+"/mini-admin/grants/"+fixture.VIPID, "", fixture.MemberToken, http.StatusOK)
	if len(current.Grant.Permissions) != 0 {
		t.Fatalf("the revoked grant remains active: %+v", current)
	}
	requestJSON[map[string]any](t, client, http.MethodGet, root+"/mini-admin/users", "", fixture.VIPToken, http.StatusForbidden)
	audit := requestJSON[struct{ Changes []miniadmin.GrantChange }](t, client, http.MethodGet, root+"/mini-admin/grant-changes", "", fixture.MemberToken, http.StatusOK)
	if len(audit.Changes) != 3 || audit.Changes[0].UserID != fixture.VIPID || len(audit.Changes[0].Permissions) != 0 || audit.Changes[0].OperatorID != fixture.MemberID {
		t.Fatalf("unexpected grant audit: %+v", audit)
	}
}

func TestMiniAdminFeedbackReplyIsSharedWithUserAndWeb(t *testing.T) {
	fixture := newAdminUsersTestServer(t)
	client, root := fixture.Server.Client(), fixture.Server.URL+"/api/v1"
	if err := fixture.Store.MiniAdmin().BootstrapOwner(context.Background(), fixture.MemberID); err != nil {
		t.Fatal(err)
	}
	body, contentType := feedbackMultipart(t, "在牌局里确认结算之后一直显示加载中。", [][]byte{feedbackPNGBytes(t)})
	upload := performFeedbackRequest(t, fixture.Server, http.MethodPost, "/api/v1/feedback", body, fixture.VIPToken, contentType)
	defer upload.Body.Close()
	var submitted struct{ ID string }
	if upload.StatusCode != http.StatusCreated || json.NewDecoder(upload.Body).Decode(&submitted) != nil {
		t.Fatalf("feedback upload returned %d", upload.StatusCode)
	}
	requestJSON[map[string]any](t, client, http.MethodGet, root+"/mini-admin/feedback/"+submitted.ID, "", fixture.AdminToken, http.StatusForbidden)
	detail := requestJSON[struct {
		Item struct{ Images []struct{ Path string } }
	}](t, client, http.MethodGet, root+"/mini-admin/feedback/"+submitted.ID, "", fixture.MemberToken, http.StatusOK)
	if len(detail.Item.Images) != 1 || !strings.HasPrefix(detail.Item.Images[0].Path, "/api/v1/mini-admin/feedback/") {
		t.Fatalf("feedback image path: %+v", detail.Item.Images)
	}
	for token, status := range map[string]int{fixture.MemberToken: http.StatusOK, fixture.AdminToken: http.StatusForbidden} {
		image := performFeedbackRequest(t, fixture.Server, http.MethodGet, detail.Item.Images[0].Path, nil, token, "")
		image.Body.Close()
		if image.StatusCode != status || image.Header.Get("Cache-Control") != "no-store" {
			t.Fatalf("private image returned %d with cache-control %s", image.StatusCode, image.Header.Get("Cache-Control"))
		}
	}
	reply := "结算页的加载问题已经修复，请重试。"
	requestJSON[map[string]any](t, client, http.MethodPost, root+"/mini-admin/feedback/"+submitted.ID+"/resolve",
		`{"status":"resolved","reply":"`+reply+`"}`, fixture.MemberToken, http.StatusOK)
	type responseItem struct{ Status, AdminReply string }
	ownerRead := requestJSON[struct{ Item responseItem }](t, client, http.MethodGet, root+"/feedback/"+submitted.ID, "", fixture.VIPToken, http.StatusOK)
	webRead := requestJSON[struct{ Items []responseItem }](t, client, http.MethodGet, root+"/admin/feedback", "", fixture.AdminToken, http.StatusOK)
	if ownerRead.Item.Status != "resolved" || ownerRead.Item.AdminReply != reply || len(webRead.Items) != 1 || webRead.Items[0] != ownerRead.Item {
		t.Fatalf("user response %+v, web response %+v", ownerRead, webRead)
	}
}

func TestMiniFeatureRevisionAndRoomMaintenance(t *testing.T) {
	fixture := newAdminUsersTestServer(t)
	client, root := fixture.Server.Client(), fixture.Server.URL+"/api/v1"
	if err := fixture.Store.MiniAdmin().BootstrapOwner(context.Background(), fixture.MemberID); err != nil {
		t.Fatal(err)
	}
	settings := `{"enabled":false,"visiblePlacements":["home"],"audience":"all","maintenance":true,"revision":0}`
	requestJSON[map[string]any](t, client, http.MethodPut, root+"/mini-admin/features/general", settings, fixture.AdminToken, http.StatusForbidden)
	feature := requestJSON[struct{ Feature miniadmin.Feature }](t, client, http.MethodPut, root+"/mini-admin/features/general", settings, fixture.MemberToken, http.StatusOK)
	if feature.Feature.Revision != 1 || !feature.Feature.Maintenance || feature.Feature.Enabled {
		t.Fatalf("unexpected feature update: %+v", feature.Feature)
	}
	requestJSON[map[string]any](t, client, http.MethodPut, root+"/mini-admin/features/general", settings, fixture.MemberToken, http.StatusConflict)
	room := `{"name":"测试牌局","displayName":"测试用户","gameType":"generic","password":"666666"}`
	disabled := requestJSON[map[string]string](t, client, http.MethodPost, root+"/miniprogram/score-rooms", room, "", http.StatusServiceUnavailable)
	if disabled["error"] != "mini_feature_maintenance" {
		t.Fatalf("maintenance error: %+v", disabled)
	}
	requestJSON[map[string]any](t, client, http.MethodPost, root+"/score-rooms", room, "", http.StatusCreated)
	requestJSON[map[string]any](t, client, http.MethodPut, root+"/mini-admin/features/general",
		strings.Replace(strings.Replace(settings, `"maintenance":true`, `"maintenance":false`, 1), `"revision":0`, `"revision":1`, 1), fixture.MemberToken, http.StatusOK)
	requestJSON[map[string]any](t, client, http.MethodPost, root+"/miniprogram/score-rooms", room, "", http.StatusCreated)
	requestJSON[map[string]any](t, client, http.MethodPut, root+"/mini-admin/features/room-join",
		`{"enabled":true,"visiblePlacements":["score"],"audience":"all","maintenance":true,"revision":0}`, fixture.MemberToken, http.StatusOK)
	requestJSON[map[string]any](t, client, http.MethodPost, root+"/miniprogram/score-rooms/join",
		`{"code":"123456","displayName":"测试用户"}`, "", http.StatusServiceUnavailable)
}

func TestMiniFeatureCatalogIsPublicAndUsesExistingDefaults(t *testing.T) {
	fixture := newAdminUsersTestServer(t)
	response := requestJSON[struct {
		Features []struct {
			ID                string
			Enabled           bool
			Audience          string
			VisiblePlacements []string
		}
	}](t, fixture.Server.Client(), http.MethodGet, fixture.Server.URL+"/api/v1/miniprogram/features", "", "", http.StatusOK)
	for _, feature := range response.Features {
		if feature.ID == "lottery" {
			if !feature.Enabled || feature.Audience != "all" || len(feature.VisiblePlacements) != 3 {
				t.Fatalf("unexpected lottery settings: %+v", feature)
			}
			return
		}
	}
	t.Fatal("lottery not found")
}
