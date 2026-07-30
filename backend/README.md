# Go 通用后端骨架

这是当前项目推荐使用的后端基础结构。它不是只为 TTS 临时写的一层转发，而是一个可以继续承载更多业务模块的 Go 服务。

当前已经接入用户鉴权、个人资料、头像文件、TTS 和翻译模块，后续可以继续增加订单、任务和日志等能力。

## 目录结构

- `cmd/api`
  服务启动入口。后面如果你要拆后台任务、定时任务、消费者，也可以继续增加 `cmd/worker`、`cmd/cron` 之类的入口。
- `internal/config`
  统一管理环境变量和服务配置。
- `internal/httpapi`
  放 HTTP 服务相关的通用能力，例如路由装配、跨域、限流、错误返回。
- `internal/auth`
  用户名密码校验、bcrypt 密码哈希、JWT 签发与校验。
- `internal/user`
  SQLite 用户数据访问和自动建表。
- `internal/tts`
  当前的 TTS 模块，包括请求结构、业务服务和火山引擎 provider。

## 当前接口

- `GET /healthz`
  健康检查。
- `GET /api/v1/system/ping`
  系统探活示例接口。
- `POST /api/v1/auth/register`
  使用手机号、密码、昵称和密保问题注册，成功后返回登录令牌。
- `POST /api/v1/auth/login`
  使用手机号和密码登录。
- `POST /api/v1/auth/password-recovery/question`
  读取已注册手机号设置的密保问题。
- `POST /api/v1/auth/password-recovery/verify`
  验证密保答案，成功后返回 10 分钟有效的一次性重置令牌。
- `POST /api/v1/auth/password-recovery/reset`
  使用重置令牌设置新密码，并使旧登录令牌失效。
- `GET /api/v1/auth/me`
  读取当前登录用户，需要 Bearer Token。
- `PATCH /api/v1/users/me`
  修改当前用户昵称。
- `POST /api/v1/users/me/avatar`
  上传 JPG 或 PNG 头像，文件字段名为 `avatar`。
- `PATCH /api/v1/users/me/password`
  修改密码并返回新令牌，旧令牌立即失效。
- `GET /avatars/{fileName}`
  读取用户头像文件。
- `GET /api/v1/users/search?q={keyword}`
  按账号或昵称搜索用户，需要 Bearer Token。
- `POST /api/v1/friend-requests`
  发送好友申请。
- `GET /api/v1/friend-requests`
  读取收到和发出的好友申请。
- `POST /api/v1/friend-requests/{requestID}/accept`
  接受好友申请并创建单聊会话。
- `POST /api/v1/friend-requests/{requestID}/reject`
  拒绝好友申请。
- `GET /api/v1/friends`
  读取好友列表和在线状态。
- `GET /api/v1/conversations`
  读取单聊会话和未读数。
- `GET /api/v1/conversations/{conversationID}/messages`
  分页读取历史消息。
- `POST /api/v1/conversations/{conversationID}/messages`
  持久化发送消息。
- `POST /api/v1/conversations/{conversationID}/read`
  更新会话已读位置。
- `POST /api/v1/realtime/ticket`
  创建一分钟有效且只能使用一次的实时连接票据。
- `GET /api/v1/realtime/ws?ticket={ticket}`
  建立 WebSocket 实时连接。
- `POST /api/v1/tts/synthesize`
  新版 TTS 接口。
- `POST /api/synthesize`
  兼容当前前端的旧接口别名。
- `GET /voice/{fileName}`
  读取生成后的音频文件。

## 设计思路

这套结构的目标是把“通用服务能力”和“具体业务模块”分开：

- `config` 负责配置
- `httpapi` 负责对外提供 HTTP 服务
- `tts` 负责语音业务

继续增加业务时，推荐每个业务一个目录，例如：

- `internal/order`
- `internal/task`

这样会比把所有逻辑都堆到一个 `server.go` 文件里更容易维护。

## 启动方式

```bash
cd backend
cp .env.example .env
go mod tidy
go run ./cmd/api
```

服务会自动尝试读取：

- `backend/.env`
- 当前工作目录下的 `.env`
- `email-agent/backend/.env`

所以你既可以在 `backend/` 目录里启动，也可以从仓库根目录启动。翻译服务会优先使用后端自己的配置；未单独配置时，也可以复用邮件助手的 DeepSeek 配置。

## 环境变量

第三方功能需要配置：

- `VOLC_APP_ID`
- `VOLC_ACCESS_TOKEN`
- `DEEPSEEK_API_KEY`

常用配置还有：

- `SERVER_HOST`
- `SERVER_PORT`
- `SERVER_PUBLIC_BASE_URL`
- `CORS_ALLOWED_ORIGINS`
- `RATE_LIMIT_WINDOW_MS`
- `RATE_LIMIT_MAX_REQUESTS`
- `TTS_MAX_TEXT_LENGTH`
- `TTS_MAX_CONTEXT_LENGTH`
- `TTS_REQUEST_TIMEOUT_MS`
- `STORAGE_AUDIO_DIR`
- `STORAGE_AVATAR_DIR`
- `STORAGE_MAX_AVATAR_BYTES`
- `DATABASE_PATH`
- `AUTH_JWT_SECRET`
- `AUTH_JWT_SECRET_FILE`
- `AUTH_TOKEN_TTL_MS`
- `DEEPSEEK_API_URL`
- `DEEPSEEK_TRANSLATION_MODEL`
- `DEEPSEEK_REQUEST_TIMEOUT_MS`
- `TRANSLATION_MAX_TEXT_LENGTH`
- `VOLC_RESOURCE_ID`
- `VOLC_ENDPOINT`

完整示例见 [backend/.env.example](c:/Users/Administrator/Desktop/my-first-expo-app/backend/.env.example)。

## 免费账户存储

默认不依赖任何付费服务：

- SQLite 数据库：`data/app.db`
- 用户头像：`data/avatars/`
- 自动生成的 JWT 密钥：`data/jwt-secret`

首次启动会自动创建这三个位置。部署和备份时必须完整保留 `data/` 目录；如果 JWT 密钥丢失，现有登录令牌会全部失效。生产环境也可以通过 `AUTH_JWT_SECRET` 直接提供至少 32 个字符的固定密钥。

## 扩展建议

如果你准备把它继续做成正式后端，推荐下一步优先补：

1. 统一日志
2. 配置分环境管理
3. 数据目录自动备份
4. 对象存储
5. 任务队列
