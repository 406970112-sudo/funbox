package timecapsule

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"my-first-expo-app/backend/internal/social"
	"my-first-expo-app/backend/internal/user"
)

func TestPersonalCapsuleSealAndOpen(t *testing.T) {
	databasePath := filepath.Join(t.TempDir(), "timecapsule.db")
	userStore, err := user.OpenStore(databasePath)
	if err != nil {
		t.Fatalf("open user store: %v", err)
	}
	t.Cleanup(func() { _ = userStore.Close() })
	store, err := OpenStore(databasePath)
	if err != nil {
		t.Fatalf("open time capsule store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	ctx := context.Background()
	account, err := userStore.Create(ctx, "13800138001", "hash", "测试用户", "question", "answer")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	openAt := time.Now().UTC().Add(2 * time.Hour)
	capsule, err := store.CreateCapsule(ctx, account.ID, CapsuleInput{
		Mode:         ModePersonal,
		Title:        "写给一个月后的自己",
		OpenRule:     OpenDate,
		OpenAt:       &openAt,
		OpenTimezone: "Asia/Shanghai",
	})
	if err != nil {
		t.Fatalf("create capsule: %v", err)
	}
	if capsule.Status != StatusDraft || capsule.MemberCount != 1 {
		t.Fatalf("unexpected capsule: %+v", capsule)
	}
	if _, err := store.AddContent(ctx, account.ID, capsule.ID, ContentInput{
		Kind:        ContentText,
		TextContent: "希望那时的我已经完成了目标",
	}); err != nil {
		t.Fatalf("add content: %v", err)
	}
	sealed, err := store.Seal(ctx, account.ID, capsule.ID)
	if err != nil {
		t.Fatalf("seal capsule: %v", err)
	}
	if sealed.Status != StatusSealed {
		t.Fatalf("expected sealed, got %+v", sealed)
	}
	hidden, err := store.ListContents(ctx, account.ID, capsule.ID, false)
	if err != nil {
		t.Fatalf("list hidden contents: %v", err)
	}
	if len(hidden) != 0 {
		t.Fatalf("expected hidden contents, got %+v", hidden)
	}

	if _, err := store.OpenDue(ctx, openAt.Add(time.Minute)); err != nil {
		t.Fatalf("open due: %v", err)
	}
	opened, err := store.GetCapsule(ctx, account.ID, capsule.ID)
	if err != nil {
		t.Fatalf("get opened capsule: %v", err)
	}
	if opened.Status != StatusOpened {
		t.Fatalf("expected opened, got %+v", opened)
	}
	contents, err := store.ListContents(ctx, account.ID, capsule.ID, false)
	if err != nil {
		t.Fatalf("list opened contents: %v", err)
	}
	if len(contents) != 1 || contents[0].TextContent != "希望那时的我已经完成了目标" {
		t.Fatalf("unexpected opened contents: %+v", contents)
	}
}

func TestJointCapsuleRequiresBothMembers(t *testing.T) {
	databasePath := filepath.Join(t.TempDir(), "joint.db")
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
	store, err := OpenStore(databasePath)
	if err != nil {
		t.Fatalf("open time capsule store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	ctx := context.Background()
	alice, err := userStore.Create(ctx, "13800138002", "hash", "小明", "question", "answer")
	if err != nil {
		t.Fatalf("create alice: %v", err)
	}
	bob, err := userStore.Create(ctx, "13800138003", "hash", "小红", "question", "answer")
	if err != nil {
		t.Fatalf("create bob: %v", err)
	}
	request, err := socialStore.CreateFriendRequest(ctx, alice.ID, bob.ID)
	if err != nil {
		t.Fatalf("create friend request: %v", err)
	}
	if _, _, err := socialStore.RespondToFriendRequest(ctx, request.ID, bob.ID, true); err != nil {
		t.Fatalf("accept friend request: %v", err)
	}

	openAt := time.Now().UTC().Add(2 * time.Hour)
	capsule, err := store.CreateCapsule(ctx, alice.ID, CapsuleInput{
		Mode:         ModeJoint,
		Title:        "恋爱一周年",
		OpenRule:     OpenDate,
		OpenAt:       &openAt,
		OpenTimezone: "Asia/Shanghai",
		FriendID:     bob.ID,
	})
	if err != nil {
		t.Fatalf("create joint capsule: %v", err)
	}
	if capsule.MemberCount != 2 {
		t.Fatalf("expected two members, got %+v", capsule)
	}
	if _, err := store.Seal(ctx, alice.ID, capsule.ID); err == nil {
		t.Fatalf("expected seal to fail before bob accepts")
	}
	if _, err := store.AcceptInvite(ctx, bob.ID, capsule.ID); err != nil {
		t.Fatalf("accept invite: %v", err)
	}
	if _, err := store.AddContent(ctx, alice.ID, capsule.ID, ContentInput{
		Kind:        ContentText,
		TextContent: "希望一年后的我们还在一起",
	}); err != nil {
		t.Fatalf("alice add content: %v", err)
	}
	if _, err := store.Seal(ctx, alice.ID, capsule.ID); err == nil {
		t.Fatalf("expected seal to fail before bob adds content")
	}
	if _, err := store.AddContent(ctx, bob.ID, capsule.ID, ContentInput{
		Kind:        ContentText,
		TextContent: "我在这边也留了一句话",
	}); err != nil {
		t.Fatalf("bob add content: %v", err)
	}
	sealed, err := store.Seal(ctx, bob.ID, capsule.ID)
	if err != nil {
		t.Fatalf("seal joint capsule: %v", err)
	}
	if sealed.Status != StatusSealed {
		t.Fatalf("expected sealed, got %+v", sealed)
	}
	if _, err := store.OpenDue(ctx, openAt.Add(time.Minute)); err != nil {
		t.Fatalf("open due: %v", err)
	}
	contents, err := store.ListContents(ctx, bob.ID, capsule.ID, false)
	if err != nil {
		t.Fatalf("list joint contents: %v", err)
	}
	if len(contents) != 2 {
		t.Fatalf("expected both contents, got %+v", contents)
	}
}
