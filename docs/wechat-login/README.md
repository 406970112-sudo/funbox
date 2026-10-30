# FunBox 微信一键注册／登录

## 行为

- 小程序启动、进入首页和游客开局均不调用 `wx.login`；用户主动进入登录页后，默认展示微信快捷登录。
- 阅读并勾选协议后点击“微信一键登录”：微信客户端提供临时 code，Go 后端通过 `code2Session` 验证身份，首次创建普通账号，后续复用原账号及现有 JWT。
- 微信新账号默认昵称“微信牌友”，无需手机号、密码或密保。昵称与头像在个人设置中主动完善。
- 原手机号密码注册、登录入口保留，并在登录页作为微信登录之外的备选方式。当前小程序不展示密码账号绑定微信的入口；不会按手机号、UnionID 或昵称自动合并账号。
- 微信或 FunBox 账号已有其他绑定时拒绝覆盖；同一绑定重复提交幂等。绑定不会改变原账号 ID、密码、角色、昵称和牌局归属。
- 退出、换号或登录页卸载后，迟到的登录响应不会恢复账号。绑定临时 code 失效可原地重试，不清除有效账号登录态。
- 游客入口从牌局页进入时返回牌局；从账号功能进入时返回首页，避免回到受保护页反复要求登录。

## 后端与部署

复用现有服务端配置（不得写入小程序或提交密钥）：

```dotenv
WECHAT_MINIPROGRAM_APP_ID=wx1c056466c78d8934
WECHAT_MINIPROGRAM_APP_SECRET=<服务端现有 AppSecret>
```

启动程序复用小程序码客户端，同时注入认证服务。不满足配置时微信登录返回 `503 wechat_unavailable`，原密码登录可继续使用。小程序 request 合法域名为 `https://www.xwhub.cn`；微信凭证兑换由服务器调用 `api.weixin.qq.com`。

已有 `backend/.env` 中两个配置项均存在（仅检查是否配置，未输出值）。尚未核验线上环境和凭证有效性，本次未部署、上传或发布。

SQLite 在后端启动时自动增加 `users.account_type`，默认 `password`；新增 `wechat_identities`，唯一约束为 `(appid, openid)` 和 `(appid, user_id)`。旧数据不重写。新微信用户内部使用随机账号标识和空密码哈希，公开 auth 响应的 `username` 为空；任何空密码均不能登录。迁移前按现有部署流程备份数据库。

新增接口：

| 接口 | 请求 | 返回 |
| --- | --- | --- |
| `POST /api/v1/auth/wechat/login` | `{ "code": "wx.login 临时凭证" }` | `{ accessToken, user }` |
| `POST /api/v1/users/me/wechat` | 同上；需要原账号 Bearer JWT | `{ user }` |

`user` 增加 `accountType`（password / wechat）、`wechatBound`；其他现有字段与鉴权方式保留。AppSecret、OpenID、UnionID、session_key 均不会出现在 auth 响应。登录接口复用认证限流，绑定接口具有认证与独立限流。

错误：空 code 为 400；失效 code 为 401 `wechat_code_invalid`（不表示已有 JWT 失效）；微信请求频繁为 429；凭证或微信服务不可用为 503；身份绑定冲突为 409 `wechat_already_bound`。客户端每次重试重新获取 code。

## 验证记录（2026-10-30）

- `node --test miniprogram/tests/*.test.js`：全部通过；认证相关四个 Go 包 race 检查、静态检查与 API 构建通过。
- 新增测试先失败后实现；覆盖微信交换错误、缺失身份、空 code、重复/并发建号、AppID 隔离、绑定幂等与冲突、HTTP JWT、私密字段、密码入口兼容。
- 客户端覆盖主动调用、协议门槛、重复点击、失败重试、退出/卸载迟到响应、绑定鉴权、原账号保留、tab 返回及游客退出。
- 微信开发者工具 Stable 2.02.2608060、基础库 3.17.5、iPhone 12/13 模拟器：确认原生 WXML/WXSS 编译；游客整卡入口、微信主入口、手机号文字备选、登录/注册切换和个人资料页无微信绑定卡均已验证。另检查 320×568 窄屏布局。历史截图（手机号入口改版前）见本目录 `implementation-simulator.png`、`implementation-320px.png`、`implementation-320px-scrolled.png`。
- 独立代码审查指出：失效微信绑定 code 的 401 不得清除原 JWT；已补回归并修复。
- 全量 `go test ./...` / `go vet ./...` 未全绿：现有 `internal/access/registry_test.go:42,49` 在 go1.22 模块中使用 `t.Context()`，触发版本 vet；`dnfactivity.TestOverview` / `TestListFiltersAndSort` 使用 2026 年 8 月活动假设仍在进行；`homerecommendation.TestEventsDeduplicateAndAudit` 将固定 8 月事件用于最近 30 天统计。这些文件未改动；已通过未改动的 HEAD 归档重新运行并复现相同失败。

## 发布前真机验收

1. 部署后端，确认数据库迁移成功、AppID 与当前小程序一致；按微信平台当前要求核对域名与服务端网络配置。
2. 游客启动不弹登录；从首页和个人页主动进入时显示微信主入口。
3. 首次微信登录建号、退出重登、重启小程序保持同一账号；可修改昵称头像。
4. 测试老账号：通过手机号密码备选入口登录，确认个人资料页不展示微信绑定入口，原昵称、历史牌局和角色保持。
5. 后端绑定接口保留但当前无小程序 UI 入口；后续若恢复入口，需重新验证已有绑定冲突和原账号保留。
6. 从房间内登录并返回，确认现有游客参与者账号追溯绑定继续工作；个人战绩可查看。
7. 检查协议页面、错误重试、账号切换、游客返回；在真机验证较窄屏幕和键盘弹起后的滚动。

本地自动化使用模拟微信 HTTP 响应，未向微信发送测试 code，未在生产环境创建测试账号。真实微信 code 兑换和线上闭环仍需部署后真机完成。
