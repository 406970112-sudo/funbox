package auth

import (
	"context"
	"errors"
	"my-first-expo-app/backend/internal/user"
	"my-first-expo-app/backend/internal/wechatminiprogram"
	"strings"
)

var (
	ErrWeChatUnavailable = errors.New("wechat login unavailable")
	ErrWeChatCodeInvalid = errors.New("wechat login code invalid")
	ErrWeChatBusy        = errors.New("wechat login rate limited")
)

type WeChatLoginClient interface {
	Code2Session(context.Context, string) (wechatminiprogram.Identity, error)
}
type weChatStore interface {
	FindOrCreateWeChat(context.Context, string, string, string) (user.User, error)
	BindWeChat(context.Context, string, string, string, string) (user.User, error)
}

func (s *Service) weChatIdentity(ctx context.Context, code string) (wechatminiprogram.Identity, error) {
	code = strings.TrimSpace(code)
	if code == "" || len(code) > 512 {
		return wechatminiprogram.Identity{}, ErrWeChatCodeInvalid
	}
	if s.weChatClient == nil {
		return wechatminiprogram.Identity{}, ErrWeChatUnavailable
	}
	identity, err := s.weChatClient.Code2Session(ctx, code)
	if err != nil {
		var apiErr *wechatminiprogram.APIError
		if errors.As(err, &apiErr) {
			switch apiErr.Code {
			case 40029, 40163, 40226:
				return identity, ErrWeChatCodeInvalid
			case 45011:
				return identity, ErrWeChatBusy
			}
		}
		return wechatminiprogram.Identity{}, ErrWeChatUnavailable
	}
	if identity.AppID == "" || identity.OpenID == "" {
		return wechatminiprogram.Identity{}, ErrWeChatUnavailable
	}
	return identity, nil
}

func (s *Service) LoginWeChat(ctx context.Context, code string) (Session, error) {
	identity, err := s.weChatIdentity(ctx, code)
	if err != nil {
		return Session{}, err
	}
	store, ok := s.store.(weChatStore)
	if !ok {
		return Session{}, ErrWeChatUnavailable
	}
	account, err := store.FindOrCreateWeChat(ctx, identity.AppID, identity.OpenID, identity.UnionID)
	if err != nil {
		return Session{}, err
	}
	return s.sessionForUser(account)
}

func (s *Service) BindWeChat(ctx context.Context, userID, code string) (user.User, error) {
	identity, err := s.weChatIdentity(ctx, code)
	if err != nil {
		return user.User{}, err
	}
	store, ok := s.store.(weChatStore)
	if !ok {
		return user.User{}, ErrWeChatUnavailable
	}
	return store.BindWeChat(ctx, userID, identity.AppID, identity.OpenID, identity.UnionID)
}
