package user

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"github.com/google/uuid"
	"strings"
	"time"
)

var ErrWeChatAlreadyBound = errors.New("wechat identity already bound")

func validWeChatIdentity(appID, openID string) bool {
	return strings.TrimSpace(appID) != "" && strings.TrimSpace(openID) != ""
}

func (s *Store) FindOrCreateWeChat(ctx context.Context, appID, openID, unionID string) (User, error) {
	if !validWeChatIdentity(appID, openID) {
		return User{}, errors.New("wechat identity required")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return User{}, err
	}
	defer tx.Rollback()
	var id string
	err = tx.QueryRowContext(ctx, `SELECT user_id FROM wechat_identities WHERE appid=? AND openid=?`, appID, openID).Scan(&id)
	if err == nil {
		account, err := scanUser(tx.QueryRowContext(ctx, userSelect+` WHERE id=?`, id))
		if err != nil {
			return User{}, err
		}
		return account, tx.Commit()
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return User{}, fmt.Errorf("find wechat identity: %w", err)
	}
	id = uuid.NewString()
	now := time.Now().UTC().Unix()
	// An unguessable internal handle preserves the legacy NOT NULL/UNIQUE schema.
	// It is not a phone number, and the empty hash cannot authenticate a password.
	_, err = tx.ExecContext(ctx, `INSERT INTO users (id,username,password_hash,display_name,account_type,created_at,updated_at) VALUES (?,?,'','微信牌友','wechat',?,?)`, id, "wx_"+uuid.NewString(), now, now)
	if err != nil {
		return User{}, fmt.Errorf("create wechat user: %w", err)
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO wechat_identities (appid,openid,user_id,unionid,created_at) VALUES (?,?,?,?,?)`, appID, openID, id, unionID, now)
	if err != nil {
		return User{}, fmt.Errorf("create wechat identity: %w", err)
	}
	account, err := scanUser(tx.QueryRowContext(ctx, userSelect+` WHERE id=?`, id))
	if err != nil {
		return User{}, err
	}
	if err = tx.Commit(); err != nil {
		return User{}, err
	}
	return account, nil
}

func (s *Store) BindWeChat(ctx context.Context, userID, appID, openID, unionID string) (User, error) {
	if !validWeChatIdentity(appID, openID) {
		return User{}, errors.New("wechat identity required")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return User{}, err
	}
	defer tx.Rollback()
	_, err = scanUser(tx.QueryRowContext(ctx, userSelect+` WHERE id=?`, userID))
	if err != nil {
		return User{}, err
	}
	var boundUserID, boundOpenID string
	err = tx.QueryRowContext(ctx, `SELECT user_id,openid FROM wechat_identities WHERE appid=? AND (openid=? OR user_id=?)`, appID, openID, userID).Scan(&boundUserID, &boundOpenID)
	if err == nil {
		if boundUserID != userID || boundOpenID != openID {
			return User{}, ErrWeChatAlreadyBound
		}
	} else if errors.Is(err, sql.ErrNoRows) {
		_, err = tx.ExecContext(ctx, `INSERT INTO wechat_identities (appid,openid,user_id,unionid,created_at) VALUES (?,?,?,?,?)`, appID, openID, userID, unionID, time.Now().UTC().Unix())
		if err != nil {
			if strings.Contains(strings.ToLower(err.Error()), "unique constraint") {
				return User{}, ErrWeChatAlreadyBound
			}
			return User{}, err
		}
	} else {
		return User{}, err
	}
	account, err := scanUser(tx.QueryRowContext(ctx, userSelect+` WHERE id=?`, userID))
	if err != nil {
		return User{}, err
	}
	if err = tx.Commit(); err != nil {
		return User{}, err
	}
	return account, nil
}
