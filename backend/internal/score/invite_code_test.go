package score

import (
	"context"
	"encoding/base64"
	"errors"
	"path/filepath"
	"testing"
	"time"
)

type fakeMiniProgramCodeGenerator struct {
	scenes []string
	data   []byte
	media  string
	width  int
	err    error
}

func (g *fakeMiniProgramCodeGenerator) Generate(_ context.Context, scene string) ([]byte, string, int, error) {
	g.scenes = append(g.scenes, scene)
	if g.err != nil {
		return nil, "", 0, g.err
	}
	return g.data, g.media, g.width, nil
}

func newInviteCodeTestService(t *testing.T, generator MiniProgramCodeGenerator) *Service {
	t.Helper()
	store, err := OpenStore(filepath.Join(t.TempDir(), "score.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return NewServiceWithOptions(
		store,
		[]byte("test-score-signing-key-with-enough-bytes"),
		7*24*time.Hour,
		ServiceOptions{MiniProgramCodeGenerator: generator},
	)
}

func TestInviteCodeUsesStableSceneAndAllowsPasswordlessJoin(t *testing.T) {
	generator := &fakeMiniProgramCodeGenerator{
		data:  []byte{0x89, 0x50, 0x4e, 0x47},
		media: "image/png",
		width: 430,
	}
	service := newInviteCodeTestService(t, generator)
	ctx := context.Background()
	created, err := service.CreateRoom(ctx, "host-user", "Host", CreateRoomInput{
		Name: "Friday game", MaxPlayers: 4, CentsPerPoint: 100, Password: "2468", GameType: GameTypeMahjong,
	})
	if err != nil {
		t.Fatal(err)
	}

	first, err := service.IssueInviteCode(ctx, created.Actor)
	if err != nil {
		t.Fatal(err)
	}
	second, err := service.IssueInviteCode(ctx, created.Actor)
	if err != nil {
		t.Fatal(err)
	}
	if first.InviteScene == "" || first.InviteScene != second.InviteScene {
		t.Fatalf("scenes = %q, %q", first.InviteScene, second.InviteScene)
	}
	if len([]rune(first.InviteScene)) > 32 {
		t.Fatalf("scene length = %d", len([]rune(first.InviteScene)))
	}
	if first.MediaType != "image/png" || first.Width != 430 {
		t.Fatalf("result = %+v", first)
	}
	image, err := base64.StdEncoding.DecodeString(first.ImageBase64)
	if err != nil || len(image) != 4 {
		t.Fatalf("image=%v error=%v", image, err)
	}

	preview, err := service.PreviewInvite(ctx, "", InvitePreviewInput{InviteScene: first.InviteScene})
	if err != nil {
		t.Fatal(err)
	}
	if preview.Room.ID != created.Room.ID || !preview.Room.RequiresPassword {
		t.Fatalf("preview = %+v", preview)
	}

	if _, err := service.JoinRoom(ctx, JoinRoomInput{Code: created.Room.Code, DisplayName: "No password"}); !errors.Is(err, ErrPasswordRequired) {
		t.Fatalf("normal code join error = %v", err)
	}
	joined, err := service.JoinRoom(ctx, JoinRoomInput{InviteScene: first.InviteScene, DisplayName: "Invited Guest"})
	if err != nil {
		t.Fatal(err)
	}
	if joined.Room.ID != created.Room.ID || joined.Room.Status != RoomWaiting {
		t.Fatalf("joined room = %+v", joined.Room)
	}
}

func TestInviteCodeRequiresHostAndHandlesGeneratorFailure(t *testing.T) {
	generator := &fakeMiniProgramCodeGenerator{
		data:  []byte{0x89, 0x50, 0x4e, 0x47},
		media: "image/png",
		width: 430,
		err:   errors.New("wechat unavailable"),
	}
	service := newInviteCodeTestService(t, generator)
	ctx := context.Background()
	created, err := service.CreateRoom(ctx, "host-user", "Host", CreateRoomInput{
		Name: "Friday game", MaxPlayers: 4, CentsPerPoint: 100,
	})
	if err != nil {
		t.Fatal(err)
	}
	guest, err := service.JoinRoom(ctx, JoinRoomInput{Code: created.Room.Code, DisplayName: "Guest"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.IssueInviteCode(ctx, guest.Actor); !errors.Is(err, ErrForbidden) {
		t.Fatalf("guest issue error = %v", err)
	}
	if _, err := service.IssueInviteCode(ctx, created.Actor); !errors.Is(err, ErrInviteCodeUnavailable) {
		t.Fatalf("generator error = %v", err)
	}
}

func TestInvalidInviteSceneIsRejected(t *testing.T) {
	service := newInviteCodeTestService(t, &fakeMiniProgramCodeGenerator{width: 430})
	ctx := context.Background()
	if _, err := service.PreviewInvite(ctx, "", InvitePreviewInput{InviteScene: "missing-scene"}); !errors.Is(err, ErrInviteInvalid) {
		t.Fatalf("preview error = %v", err)
	}
	if _, err := service.JoinRoom(ctx, JoinRoomInput{InviteScene: "missing-scene", DisplayName: "Guest"}); !errors.Is(err, ErrInviteInvalid) {
		t.Fatalf("join error = %v", err)
	}
}
