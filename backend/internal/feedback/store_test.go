package feedback

import (
	"context"
	"errors"
	"path/filepath"
	"testing"

	"my-first-expo-app/backend/internal/user"
)

func TestStoreCreateAndListFeedback(t *testing.T) {
	store, userID := openFeedbackTestStore(t)
	created, err := store.Create(context.Background(), userID, "upload page has no response", []Image{
		{ID: "image-1", StoredName: "feedback-1-image-1.png", ContentType: "image/png", SizeBytes: 128, SortOrder: 0},
	})
	if err != nil {
		t.Fatal(err)
	}
	page, err := store.List(context.Background(), 30, 0)
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 1 || len(page.Items) != 1 {
		t.Fatalf("unexpected page: %#v", page)
	}
	if page.Items[0].ID != created.ID || page.Items[0].User.ID != userID {
		t.Fatalf("unexpected submission: %#v", page.Items[0])
	}
	if len(page.Items[0].Images) != 1 || page.Items[0].Images[0].ID != "image-1" {
		t.Fatalf("unexpected images: %#v", page.Items[0].Images)
	}
}

func TestStoreListsNewestFirstAndPaginates(t *testing.T) {
	store, userID := openFeedbackTestStore(t)
	first, err := store.Create(context.Background(), userID, "first valid feedback description", nil)
	if err != nil {
		t.Fatal(err)
	}
	second, err := store.Create(context.Background(), userID, "second valid feedback description", nil)
	if err != nil {
		t.Fatal(err)
	}
	page, err := store.List(context.Background(), 1, 0)
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 2 || page.Items[0].ID != second.ID || page.Items[0].ID == first.ID {
		t.Fatalf("unexpected order: %#v", page)
	}
}

func TestStoreGetImageChecksFeedbackOwnership(t *testing.T) {
	store, userID := openFeedbackTestStore(t)
	created, err := store.Create(context.Background(), userID, "image ownership must be verified", []Image{
		{ID: "image-1", StoredName: "a.png", ContentType: "image/png", SizeBytes: 1},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.GetImage(context.Background(), "other-feedback", "image-1"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected not found, got %v", err)
	}
	if _, err := store.GetImage(context.Background(), created.ID, "image-1"); err != nil {
		t.Fatal(err)
	}
}

func TestStoreFiltersResolvesAndTracksNotifications(t *testing.T) {
	store, userID := openFeedbackTestStore(t)
	created, err := store.CreateWithType(
		context.Background(),
		userID,
		"feature_request",
		"发票识别",
		"tool",
		"希望增加发票识别工具，上传或拍照后自动识别发票金额、抬头和税号",
		nil,
	)
	if err != nil {
		t.Fatal(err)
	}

	featurePage, err := store.ListFiltered(context.Background(), ListOptions{
		Kind:   "feature_request",
		Limit:  30,
		Offset: 0,
	})
	if err != nil {
		t.Fatal(err)
	}
	if featurePage.Total != 1 || featurePage.Items[0].Title != "发票识别" {
		t.Fatalf("unexpected feature page: %#v", featurePage)
	}

	notifications, err := store.ListNotifications(context.Background(), userID, 30, 0)
	if err != nil {
		t.Fatal(err)
	}
	if notifications.Total != 0 {
		t.Fatalf("pending feedback should not be a notification: %#v", notifications)
	}

	resolved, err := store.Resolve(
		context.Background(),
		created.ID,
		"admin-user",
		"resolved",
		"已评估，计划加入工具分类，先做拍照识别",
	)
	if err != nil {
		t.Fatal(err)
	}
	if resolved.Status != "resolved" || resolved.AdminReply == "" || resolved.AdminUserID != "admin-user" {
		t.Fatalf("unexpected resolved feedback: %#v", resolved)
	}

	unread, err := store.UnreadCount(context.Background(), userID)
	if err != nil {
		t.Fatal(err)
	}
	if unread != 1 {
		t.Fatalf("unread count = %d", unread)
	}

	notifications, err = store.ListNotifications(context.Background(), userID, 30, 0)
	if err != nil {
		t.Fatal(err)
	}
	if notifications.Total != 1 || notifications.Items[0].ID != created.ID {
		t.Fatalf("unexpected notifications: %#v", notifications)
	}

	if err := store.MarkNotificationsRead(context.Background(), userID, nil); err != nil {
		t.Fatal(err)
	}
	unread, err = store.UnreadCount(context.Background(), userID)
	if err != nil {
		t.Fatal(err)
	}
	if unread != 0 {
		t.Fatalf("unread after read = %d", unread)
	}

	if _, err := store.GetByUser(context.Background(), userID, created.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.GetByUser(context.Background(), "other-user", created.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected not found for other user, got %v", err)
	}
}

func openFeedbackTestStore(t *testing.T) (*Store, string) {
	t.Helper()
	databasePath := filepath.Join(t.TempDir(), "app.db")
	userStore, err := user.OpenStore(databasePath)
	if err != nil {
		t.Fatal(err)
	}
	account, err := userStore.Create(
		context.Background(),
		"13800138000",
		"hash",
		"Test User",
		"Question",
		"answer-hash",
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := userStore.Close(); err != nil {
		t.Fatal(err)
	}
	store, err := OpenStore(databasePath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store, account.ID
}
