package blog

import (
	"context"
	"errors"
	"path/filepath"
	"testing"

	"my-first-expo-app/backend/internal/social"
	"my-first-expo-app/backend/internal/user"
)

func TestBlogVisibilityAndPublicFeed(t *testing.T) {
	fixture := openBlogTestStore(t, "Alice", "Bob", "Carol")
	store := fixture.store
	alice := fixture.accounts[0]
	bob := fixture.accounts[1]
	carol := fixture.accounts[2]
	ctx := context.Background()

	publicPost, err := store.Create(ctx, alice.ID, "公开文章", "", "正文内容", "", VisibilityPublic)
	if err != nil {
		t.Fatalf("create public post: %v", err)
	}
	friendPost, err := store.Create(ctx, alice.ID, "好友文章", "", "正文内容", "", VisibilityFriends)
	if err != nil {
		t.Fatalf("create friends post: %v", err)
	}
	privatePost, err := store.Create(ctx, alice.ID, "私密文章", "", "正文内容", "", VisibilitySelf)
	if err != nil {
		t.Fatalf("create self post: %v", err)
	}
	if publicPost.WordCount != 4 || privatePost.WordCount != 4 {
		t.Fatalf("word counts = %d, %d", publicPost.WordCount, privatePost.WordCount)
	}

	publicFeed, err := store.ListFeed(ctx, "", "public", "", 20)
	if err != nil {
		t.Fatalf("anonymous public feed: %v", err)
	}
	if len(publicFeed.Items) != 1 || publicFeed.Items[0].ID != publicPost.ID {
		t.Fatalf("anonymous public feed = %+v", publicFeed.Items)
	}

	if _, err := store.Get(ctx, "", friendPost.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("anonymous friend post error = %v, want forbidden", err)
	}
	if _, err := store.Get(ctx, carol.ID, friendPost.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("non-friend get error = %v, want forbidden", err)
	}
	if _, err := store.Get(ctx, "", privatePost.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("anonymous self post error = %v, want forbidden", err)
	}

	makeBlogFriends(t, fixture.socialStore, bob.ID, alice.ID)
	bobFriendsFeed, err := store.ListFeed(ctx, bob.ID, "friends", "", 20)
	if err != nil {
		t.Fatalf("bob friends feed: %v", err)
	}
	if len(bobFriendsFeed.Items) != 1 || bobFriendsFeed.Items[0].ID != friendPost.ID {
		t.Fatalf("bob friends feed = %+v, want only friend post", bobFriendsFeed.Items)
	}
	for _, item := range bobFriendsFeed.Items {
		if item.ID == privatePost.ID {
			t.Fatal("bob saw private post")
		}
	}

	if _, err := store.Get(ctx, bob.ID, privatePost.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("bob self post error = %v, want forbidden", err)
	}
	ownDetail, err := store.Get(ctx, alice.ID, privatePost.ID)
	if err != nil {
		t.Fatalf("author get self post: %v", err)
	}
	if ownDetail.ID != privatePost.ID {
		t.Fatalf("own detail = %+v", ownDetail)
	}
}

func TestBlogLikesCommentsNotificationsAndAdmin(t *testing.T) {
	fixture := openBlogTestStore(t, "Alice", "Bob")
	store := fixture.store
	alice := fixture.accounts[0]
	bob := fixture.accounts[1]
	ctx := context.Background()
	makeBlogFriends(t, fixture.socialStore, bob.ID, alice.ID)

	created, err := store.Create(ctx, alice.ID, "测试文章", "摘要", "正文内容", "", VisibilityFriends)
	if err != nil {
		t.Fatalf("create post: %v", err)
	}
	liked, err := store.Like(ctx, bob.ID, created.ID)
	if err != nil {
		t.Fatalf("like post: %v", err)
	}
	if !liked {
		t.Fatal("like did not create a record")
	}
	retry, err := store.Like(ctx, bob.ID, created.ID)
	if err != nil {
		t.Fatalf("retry like: %v", err)
	}
	if retry {
		t.Fatal("duplicate like created a record")
	}
	detail, err := store.Get(ctx, bob.ID, created.ID)
	if err != nil {
		t.Fatalf("get post: %v", err)
	}
	if detail.LikeCount != 1 || !detail.LikedByMe {
		t.Fatalf("liked detail = %+v", detail)
	}

	comment, err := store.Comment(ctx, bob.ID, created.ID, "", "写得很好", nil)
	if err != nil {
		t.Fatalf("comment post: %v", err)
	}
	if comment.Author.ID != bob.ID {
		t.Fatalf("comment author = %+v", comment.Author)
	}
	reply, err := store.Comment(ctx, alice.ID, created.ID, comment.ID, "谢谢", nil)
	if err != nil {
		t.Fatalf("reply comment: %v", err)
	}
	if reply.ParentID != comment.ID {
		t.Fatalf("reply parent = %q", reply.ParentID)
	}

	comments, err := store.ListComments(ctx, bob.ID, created.ID, "", 20)
	if err != nil {
		t.Fatalf("list comments: %v", err)
	}
	if len(comments.Items) != 2 {
		t.Fatalf("comments = %+v", comments.Items)
	}

	bobNotifications, err := store.Notifications(ctx, bob.ID, "", 20)
	if err != nil {
		t.Fatalf("bob notifications: %v", err)
	}
	if bobNotifications.UnreadCount != 1 || bobNotifications.Items[0].Type != "post.reply" {
		t.Fatalf("bob notifications = %+v", bobNotifications)
	}
	if err := store.MarkNotificationsRead(ctx, bob.ID, created.ID); err != nil {
		t.Fatalf("mark read: %v", err)
	}
	count, err := store.UnreadCount(ctx, bob.ID)
	if err != nil {
		t.Fatalf("unread count: %v", err)
	}
	if count != 0 {
		t.Fatalf("unread count = %d", count)
	}

	if err := store.Report(ctx, bob.ID, "post", created.ID, "内容不合适"); err != nil {
		t.Fatalf("report post: %v", err)
	}
	if err := store.Report(ctx, bob.ID, "post", created.ID, "重复报告"); !errors.Is(err, ErrReportExists) {
		t.Fatalf("duplicate report error = %v, want report exists", err)
	}

	page, err := store.AdminList(ctx, PostStatusActive, "", 20)
	if err != nil {
		t.Fatalf("admin list: %v", err)
	}
	if len(page.Items) != 1 || page.Items[0].ReportCount != 1 {
		t.Fatalf("admin list = %+v", page.Items)
	}
	if err := store.AdminHide(ctx, created.ID); err != nil {
		t.Fatalf("admin hide: %v", err)
	}
	if _, err := store.Get(ctx, alice.ID, created.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("get hidden post error = %v, want not found", err)
	}
	hidden, err := store.AdminList(ctx, PostStatusHidden, "", 20)
	if err != nil {
		t.Fatalf("admin hidden list: %v", err)
	}
	if len(hidden.Items) != 1 || hidden.Items[0].ID != created.ID {
		t.Fatalf("hidden list = %+v", hidden.Items)
	}
}

func TestBlogPublicFeedEnrichesLikesAndCommentsForAnonymousViewer(t *testing.T) {
	fixture := openBlogTestStore(t, "Alice", "Bob")
	store := fixture.store
	alice := fixture.accounts[0]
	bob := fixture.accounts[1]
	ctx := context.Background()
	makeBlogFriends(t, fixture.socialStore, bob.ID, alice.ID)

	created, err := store.Create(ctx, alice.ID, "公开文章", "", "正文内容", "", VisibilityPublic)
	if err != nil {
		t.Fatalf("create public post: %v", err)
	}
	if _, err := store.Like(ctx, bob.ID, created.ID); err != nil {
		t.Fatalf("like public post: %v", err)
	}
	if _, err := store.Comment(ctx, bob.ID, created.ID, "", "评论", nil); err != nil {
		t.Fatalf("comment public post: %v", err)
	}
	page, err := store.ListFeed(ctx, "", "public", "", 20)
	if err != nil {
		t.Fatalf("anonymous public feed: %v", err)
	}
	if len(page.Items) != 1 {
		t.Fatalf("public feed = %+v", page.Items)
	}
	item := page.Items[0]
	if item.LikeCount != 1 || item.CommentCount != 1 {
		t.Fatalf("enriched item = %+v", item)
	}
	if len(item.RecentComments) != 1 || item.RecentComments[0].Body != "评论" {
		t.Fatalf("recent comments = %+v", item.RecentComments)
	}
}

type blogTestFixture struct {
	accounts    []user.User
	socialStore *social.Store
	store       *Store
}

func openBlogTestStore(t *testing.T, names ...string) blogTestFixture {
	t.Helper()
	databasePath := filepath.Join(t.TempDir(), "blog.db")
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
		t.Fatalf("open blog store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	socialStore, err := social.OpenStore(databasePath)
	if err != nil {
		t.Fatalf("open social store: %v", err)
	}
	t.Cleanup(func() { _ = socialStore.Close() })
	return blogTestFixture{
		accounts:    accounts,
		socialStore: socialStore,
		store:       store,
	}
}

func makeBlogFriends(t *testing.T, socialStore *social.Store, senderID string, recipientID string) {
	t.Helper()
	request, err := socialStore.CreateFriendRequest(context.Background(), senderID, recipientID)
	if err != nil {
		t.Fatalf("create friend request: %v", err)
	}
	if _, _, err := socialStore.RespondToFriendRequest(context.Background(), request.ID, recipientID, true); err != nil {
		t.Fatalf("accept friend request: %v", err)
	}
}
