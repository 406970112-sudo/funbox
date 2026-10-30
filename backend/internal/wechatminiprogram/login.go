package wechatminiprogram

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
)

// Identity contains only server-verified identity fields; session_key is unused.
type Identity struct{ AppID, OpenID, UnionID string }

func (c *Client) Code2Session(ctx context.Context, code string) (Identity, error) {
	code = strings.TrimSpace(code)
	if code == "" || len(code) > 512 {
		return Identity{}, errors.New("invalid wechat login code")
	}
	query := url.Values{"appid": {c.cfg.AppID}, "secret": {c.cfg.AppSecret}, "js_code": {code}, "grant_type": {"authorization_code"}}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.cfg.BaseURL+"/sns/jscode2session?"+query.Encode(), nil)
	if err != nil {
		return Identity{}, errors.New("create wechat login request failed")
	}
	// Never propagate transport errors: their URL can contain AppSecret and code.
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return Identity{}, errors.New("wechat login request failed")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return Identity{}, errors.New("wechat login service unavailable")
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, defaultResponseLimit+1))
	if err != nil || len(body) > defaultResponseLimit {
		return Identity{}, errors.New("read wechat login response failed")
	}
	var result struct {
		OpenID  string `json:"openid"`
		UnionID string `json:"unionid"`
		ErrCode int    `json:"errcode"`
	}
	if json.Unmarshal(body, &result) != nil {
		return Identity{}, errors.New("invalid wechat login response")
	}
	if result.ErrCode != 0 {
		return Identity{}, &APIError{Code: result.ErrCode, Message: "wechat login exchange rejected"}
	}
	if strings.TrimSpace(result.OpenID) == "" {
		return Identity{}, errors.New("wechat login identity missing")
	}
	return Identity{AppID: c.cfg.AppID, OpenID: result.OpenID, UnionID: result.UnionID}, nil
}
