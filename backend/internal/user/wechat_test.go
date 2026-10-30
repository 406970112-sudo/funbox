package user_test

import (
	"context"
	"errors"
	"my-first-expo-app/backend/internal/user"
	"sync"
	"testing"
)

func TestWeChatSignupIsStableAndConcurrent(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	const n = 10
	ids := make(chan string, n)
	errs := make(chan error, n)
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			u, err := store.FindOrCreateWeChat(ctx, "app", "open", "union")
			ids <- u.ID
			errs <- err
		}()
	}
	wg.Wait()
	close(ids)
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	id := ""
	for next := range ids {
		if id != "" && id != next {
			t.Fatal("duplicate accounts")
		}
		id = next
	}
	u, err := store.GetByID(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	if u.AccountType != "wechat" || u.PasswordHash != "" || !u.WeChatBound || u.Role != "normal" || u.DisplayName != "微信牌友" {
		t.Fatalf("unexpected account %+v", u)
	}
	list, err := store.List(ctx, user.ListOptions{})
	if err != nil || list.Total != 1 {
		t.Fatalf("list=%+v err=%v", list, err)
	}
	other, err := store.FindOrCreateWeChat(ctx, "other-app", "open", "")
	if err != nil || other.ID == id {
		t.Fatal("cross-app identity collision")
	}
}

func TestWeChatBindingKeepsLegacyAccountAndRejectsConflicts(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	old, err := store.Create(ctx, "13800138000", "existing-hash", "老牌友", "问题", "answer")
	if err != nil {
		t.Fatal(err)
	}
	bound, err := store.BindWeChat(ctx, old.ID, "app", "open", "")
	if err != nil {
		t.Fatal(err)
	}
	if bound.ID != old.ID || bound.Username != old.Username || bound.PasswordHash != old.PasswordHash || bound.DisplayName != old.DisplayName || !bound.WeChatBound {
		t.Fatalf("changed legacy account %+v", bound)
	}
	again, err := store.FindOrCreateWeChat(ctx, "app", "open", "")
	if err != nil || again.ID != old.ID {
		t.Fatal("login did not use bound account")
	}
	if _, err = store.BindWeChat(ctx, old.ID, "app", "open", ""); err != nil {
		t.Fatal("binding is not idempotent", err)
	}
	other, err := store.FindOrCreateWeChat(ctx, "app", "other-open", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.BindWeChat(ctx, other.ID, "app", "open", ""); !errors.Is(err, user.ErrWeChatAlreadyBound) {
		t.Fatalf("identity stolen: %v", err)
	}
	if _, err = store.BindWeChat(ctx, old.ID, "app", "third-open", ""); !errors.Is(err, user.ErrWeChatAlreadyBound) {
		t.Fatalf("existing binding replaced: %v", err)
	}
	if _, err = store.BindWeChat(ctx, "missing-user", "app", "unbound-open", ""); !errors.Is(err, user.ErrNotFound) {
		t.Fatalf("bound nonexistent account: %v", err)
	}
}
