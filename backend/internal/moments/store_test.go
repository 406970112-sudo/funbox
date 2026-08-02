package moments

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"my-first-expo-app/backend/internal/social"
	"my-first-expo-app/backend/internal/user"
)

func TestMomentFeedRequiresFriendshipAndTracksLikes(t *testing.T) {
	fixture := openMomentsTestStore(t, "Alice", "Bob", "Carol")
	store := fixture.store
	alice := fixture.accounts[0]
	bob := fixture.accounts[1]
	carol := fixture.accounts[2]
	ctx := context.Background()

	created, err := store.Create(ctx, alice.ID, "第一次用 FunBox 记录动态", VisibilityFriends, nil, nil)
	if err != nil {
		t.Fatalf("create moment: %v", err)
	}
	if created.Author.ID != alice.ID || created.Status != MomentStatusActive {
		t.Fatalf("created moment = %+v", created)
	}

	bobFeed, err := store.ListFeed(ctx, bob.ID, "", "", 20)
	if err != nil {
		t.Fatalf("bob feed: %v", err)
	}
	if len(bobFeed.Items) != 0 {
		t.Fatalf("bob saw non-friend moment before friendship: %d", len(bobFeed.Items))
	}

	makeTestFriends(t, fixture.socialStore, bob.ID, alice.ID)
	bobFeed, err = store.ListFeed(ctx, bob.ID, "", "", 20)
	if err != nil {
		t.Fatalf("bob feed after friendship: %v", err)
	}
	if len(bobFeed.Items) != 1 || bobFeed.Items[0].ID != created.ID {
		t.Fatalf("bob feed = %+v", bobFeed.Items)
	}

	carolFeed, err := store.ListFeed(ctx, carol.ID, "", "", 20)
	if err != nil {
		t.Fatalf("carol feed: %v", err)
	}
	if len(carolFeed.Items) != 0 {
		t.Fatalf("carol saw non-friend moment: %d", len(carolFeed.Items))
	}
	if _, err := store.Get(ctx, carol.ID, created.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("carol get error = %v, want ErrForbidden", err)
	}

	liked, err := store.Like(ctx, bob.ID, created.ID)
	if err != nil {
		t.Fatalf("like moment: %v", err)
	}
	if !liked {
		t.Fatal("like did not create a record")
	}
	retryLiked, err := store.Like(ctx, bob.ID, created.ID)
	if err != nil {
		t.Fatalf("retry like moment: %v", err)
	}
	if retryLiked {
		t.Fatal("duplicate like created a record")
	}

	detail, err := store.Get(ctx, bob.ID, created.ID)
	if err != nil {
		t.Fatalf("get moment: %v", err)
	}
	if detail.LikeCount != 1 || !detail.LikedByMe || len(detail.RecentLikers) != 1 {
		t.Fatalf("liked detail = %+v", detail)
	}

	removed, err := store.Unlike(ctx, bob.ID, created.ID)
	if err != nil {
		t.Fatalf("unlike moment: %v", err)
	}
	if !removed {
		t.Fatal("unlike did not remove a record")
	}
	detail, err = store.Get(ctx, bob.ID, created.ID)
	if err != nil {
		t.Fatalf("get moment after unlike: %v", err)
	}
	if detail.LikeCount != 0 || detail.LikedByMe {
		t.Fatalf("unliked detail = %+v", detail)
	}
}

func TestMomentCommentsCreateNotificationsAndRespectDeletes(t *testing.T) {
	fixture := openMomentsTestStore(t, "Alice", "Bob")
	store := fixture.store
	alice := fixture.accounts[0]
	bob := fixture.accounts[1]
	ctx := context.Background()
	makeTestFriends(t, fixture.socialStore, bob.ID, alice.ID)

	created, err := store.Create(ctx, alice.ID, "好友动态测试", VisibilityFriends, nil, nil)
	if err != nil {
		t.Fatalf("create moment: %v", err)
	}
	comment, err := store.Comment(ctx, bob.ID, created.ID, "", "厉害，一起玩", nil)
	if err != nil {
		t.Fatalf("comment moment: %v", err)
	}
	if comment.Author.ID != bob.ID {
		t.Fatalf("comment author = %+v", comment.Author)
	}

	notifications, err := store.Notifications(ctx, alice.ID, "", 20)
	if err != nil {
		t.Fatalf("list notifications: %v", err)
	}
	if notifications.UnreadCount != 1 || len(notifications.Items) != 1 {
		t.Fatalf("notifications = %+v", notifications)
	}
	if notifications.Items[0].Type != "comment" || notifications.Items[0].Actor.ID != bob.ID {
		t.Fatalf("notification item = %+v", notifications.Items[0])
	}

	page, err := store.ListComments(ctx, alice.ID, created.ID, "", 20)
	if err != nil {
		t.Fatalf("list comments: %v", err)
	}
	if len(page.Items) != 1 || page.Items[0].ID != comment.ID {
		t.Fatalf("comments = %+v", page.Items)
	}

	if err := store.MarkNotificationsRead(ctx, alice.ID, created.ID); err != nil {
		t.Fatalf("mark notifications read: %v", err)
	}
	notifications, err = store.Notifications(ctx, alice.ID, "", 20)
	if err != nil {
		t.Fatalf("list notifications after read: %v", err)
	}
	if notifications.UnreadCount != 0 || !notifications.Items[0].Read {
		t.Fatalf("read notifications = %+v", notifications)
	}

	if err := store.DeleteComment(ctx, bob.ID, comment.ID); err != nil {
		t.Fatalf("delete own comment: %v", err)
	}
	page, err = store.ListComments(ctx, alice.ID, created.ID, "", 20)
	if err != nil {
		t.Fatalf("list comments after delete: %v", err)
	}
	if len(page.Items) != 0 {
		t.Fatalf("deleted comments = %+v", page.Items)
	}
}

func TestMomentVisibilityAndDeleteAreAuthoritative(t *testing.T) {
	fixture := openMomentsTestStore(t, "Alice", "Bob")
	store := fixture.store
	alice := fixture.accounts[0]
	bob := fixture.accounts[1]
	ctx := context.Background()
	makeTestFriends(t, fixture.socialStore, bob.ID, alice.ID)

	created, err := store.Create(ctx, alice.ID, "仅自己可见动态", VisibilityFriends, nil, nil)
	if err != nil {
		t.Fatalf("create moment: %v", err)
	}
	if _, err := store.UpdateVisibility(ctx, alice.ID, created.ID, VisibilitySelf); err != nil {
		t.Fatalf("update visibility: %v", err)
	}
	if _, err := store.Get(ctx, bob.ID, created.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("bob get self-only moment error = %v, want ErrForbidden", err)
	}
	if _, err := store.Get(ctx, alice.ID, created.ID); err != nil {
		t.Fatalf("alice get own moment: %v", err)
	}

	if err := store.Delete(ctx, alice.ID, created.ID); err != nil {
		t.Fatalf("delete moment: %v", err)
	}
	if _, err := store.Get(ctx, alice.ID, created.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("get deleted moment error = %v, want ErrNotFound", err)
	}
	if err := store.Delete(ctx, bob.ID, created.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("delete others moment error = %v, want ErrNotFound", err)
	}
}

func TestMomentSupportsRealScoreAttachment(t *testing.T) {
	fixture := openMomentsTestStore(t, "Alice")
	store := fixture.store
	alice := fixture.accounts[0]
	ctx := context.Background()
	if _, err := fixture.socialStore.SubmitGameScore(ctx, alice.ID, "brick-breaker", 88, time.Now().UTC()); err != nil {
		t.Fatalf("submit game score: %v", err)
	}
	options, err := store.ListAttachmentOptions(ctx, alice.ID, 20)
	if err != nil {
		t.Fatalf("list attachment options: %v", err)
	}
	if len(options) == 0 || options[0].Type != "game_result" {
		t.Fatalf("attachment options = %+v", options)
	}
	created, err := store.Create(ctx, alice.ID, "分享真实战绩", VisibilityFriends, nil, &Attachment{
		Type:     "game_result",
		RefTable: "game_score_submissions",
		RefID:    options[0].RefID,
	})
	if err != nil {
		t.Fatalf("create moment with attachment: %v", err)
	}
	if len(created.Attachments) != 1 || !strings.Contains(created.Attachments[0].PayloadJSON, `"result"`) {
		t.Fatalf("moment attachments = %+v", created.Attachments)
	}
}

func TestAdminListAndHideMoments(t *testing.T) {
	fixture := openMomentsTestStore(t, "Alice", "Bob")
	store := fixture.store
	alice := fixture.accounts[0]
	bob := fixture.accounts[1]
	ctx := context.Background()
	makeTestFriends(t, fixture.socialStore, bob.ID, alice.ID)

	created, err := store.Create(ctx, alice.ID, "需要管理的内容", VisibilityFriends, nil, nil)
	if err != nil {
		t.Fatalf("create moment: %v", err)
	}
	if err := store.Report(ctx, bob.ID, created.ID, "内容不合适"); err != nil {
		t.Fatalf("report moment: %v", err)
	}

	page, err := store.AdminList(ctx, MomentStatusActive, "", 20)
	if err != nil {
		t.Fatalf("admin list: %v", err)
	}
	if len(page.Items) != 1 || page.Items[0].ReportCount != 1 {
		t.Fatalf("admin list = %+v", page.Items)
	}
	if err := store.AdminHide(ctx, created.ID); err != nil {
		t.Fatalf("admin hide: %v", err)
	}
	page, err = store.AdminList(ctx, MomentStatusActive, "", 20)
	if err != nil {
		t.Fatalf("admin list after hide: %v", err)
	}
	if len(page.Items) != 0 {
		t.Fatalf("active moments after hide = %+v", page.Items)
	}
	hidden, err := store.AdminList(ctx, MomentStatusHidden, "", 20)
	if err != nil {
		t.Fatalf("admin hidden list: %v", err)
	}
	if len(hidden.Items) != 1 || hidden.Items[0].ID != created.ID {
		t.Fatalf("hidden moments = %+v", hidden.Items)
	}
}

type momentsTestFixture struct {
	accounts    []user.User
	socialStore *social.Store
	store       *Store
}

func openMomentsTestStore(t *testing.T, names ...string) momentsTestFixture {
	t.Helper()
	databasePath := filepath.Join(t.TempDir(), "moments.db")
	userStore, err := user.OpenStore(databasePath)
	if err != nil {
		t.Fatalf("open user store: %v", err)
	}
	t.Cleanup(func() { _ = userStore.Close() })

	accounts := make([]user.User, 0, len(names))
	for index, name := range names {
		account, createErr := userStore.Create(
			context.Background(),
			"1380013800"+string(rune('0'+index)),
			"hash",
			name,
			"question",
			"answer-hash",
		)
		if createErr != nil {
			t.Fatalf("create user %s: %v", name, createErr)
		}
		accounts = append(accounts, account)
	}

	store, err := OpenStore(databasePath)
	if err != nil {
		t.Fatalf("open moments store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	socialStore, err := social.OpenStore(databasePath)
	if err != nil {
		t.Fatalf("open social store: %v", err)
	}
	t.Cleanup(func() { _ = socialStore.Close() })
	return momentsTestFixture{
		accounts:    accounts,
		socialStore: socialStore,
		store:       store,
	}
}

func makeTestFriends(t *testing.T, socialStore *social.Store, senderID string, recipientID string) {
	t.Helper()
	request, err := socialStore.CreateFriendRequest(context.Background(), senderID, recipientID)
	if err != nil {
		t.Fatalf("create friend request: %v", err)
	}
	if _, _, err := socialStore.RespondToFriendRequest(context.Background(), request.ID, recipientID, true); err != nil {
		t.Fatalf("accept friend request: %v", err)
	}
}
