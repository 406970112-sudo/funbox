# FunBox

一个移动端工具集合与社交娱乐平台，采用"一个仓库、前后端分目录"的方式组织。Expo 前端提供工具、小游戏、阅读、社交和后台管理页面；Go 后端提供统一 API、账号体系、实时通信与业务接口；仓库内还包含一个基于 DeepSeek 的邮件/通知智能体。

## 功能概览

- **工具集合**：TTS 语音合成、智能翻译、AI 导航、图片压缩、二维码生成、双色球、市场雷达、热点资讯、资源搜索、卡片计分、直播推流辅助、版本发布邮件助手等。
- **小游戏**：五子棋、打砖块、俄罗斯方块、贪吃蛇等，支持本地对局与成绩提交。
- **阅读**：书籍浏览、章节阅读、书签、书架、阅读进度，支持后台导入和管理。
- **社交**：账号注册/登录、好友申请、单聊、消息已读、在线状态、WebSocket 实时消息。
- **账号体系**：JWT 登录、密码找回（密保问题）、头像上传、个人资料修改、角色与功能权限。
- **管理后台**：反馈处理（问题与功能建议）、阅读内容管理、功能权限配置、用户角色管理。
- **邮件智能体**：DeepSeek 驱动的 AI 助手，可查询收件人、天气并自动生成/发送通知邮件，附带收件人目录管理界面。

## 目录结构

| 目录 | 说明 |
| --- | --- |
| `frontend/` | Expo + React Native 前端，使用 expo-router，按 `app/` 路由组织页面，`features/` 存放功能实现 |
| `backend/` | Go 后端服务，统一 API、认证、社交、实时通信及各业务模块 |
| `email-agent/` | 邮件智能体：`backend/` 为 Koa + TypeScript + AI SDK 服务，`frontend/` 为 Vite + React 管理界面 |
| `email-agent-backend/` | 邮件智能体后端的独立工作副本 |
| `docs/` | 产品设计稿、原型与设计文档 |
| `deploy/` | 部署脚本和服务器初始化模板 |
| `scripts/` | 辅助脚本 |

## 本地开发

根目录使用 npm workspaces，常用命令：

```bash
# 前端（Expo）
npm run frontend:web
npm run frontend:android
npm run frontend:ios

# 邮件智能体后端
npm run email-agent:dev

# 邮件智能体前端
npm run email-agent:web
```

### 前端

```bash
cd frontend
npm install
npm run web
```

环境变量示例见 `frontend/.env.example`。

### Go 后端

```bash
cd backend
cp .env.example .env
go mod tidy
go run ./cmd/api
```

服务会自动读取 `backend/.env`、当前工作目录下的 `.env`，以及 `email-agent/backend/.env`，所以既可以在 `backend/` 内启动，也可以从仓库根目录启动。首次启动会自动创建 SQLite 数据库、头像目录、反馈图片目录、收款码目录和 JWT 密钥。

核心配置项：

- 服务：`SERVER_HOST`、`SERVER_PORT`、`SERVER_PUBLIC_BASE_URL`、`CORS_ALLOWED_ORIGINS`
- 第三方：`VOLC_APP_ID`、`VOLC_ACCESS_TOKEN`（火山引擎 TTS）、`DEEPSEEK_API_KEY`（翻译/摘要/邮件代理）
- 存储：`STORAGE_AUDIO_DIR`、`STORAGE_AVATAR_DIR`、`STORAGE_FEEDBACK_DIR`、`STORAGE_PAYMENT_QR_DIR`、`DATABASE_PATH`
- 认证：`AUTH_JWT_SECRET` / `AUTH_JWT_SECRET_FILE`、`AUTH_TOKEN_TTL_MS`
- 限流：`RATE_LIMIT_WINDOW_MS`、`RATE_LIMIT_MAX_REQUESTS`

完整示例见 `backend/.env.example`。

### 邮件智能体

```bash
cd email-agent/backend
cp .env.example .env
npm install
npm run dev

cd ../frontend
npm install
npm run dev
```

后端提供 `POST /api/agent`（SSE 流式 AI 对话）和 `GET /api/recipients`（收件人目录），通过 DeepSeek 解析需求并调用工具查询收件人、天气和发送邮件。

## 后端主要接口

- 健康检查与系统：`GET /healthz`、`GET /api/v1/system/ping`
- 认证：注册、登录、密码找回（密保问题验证 + 一次性重置令牌）、当前用户、改密
- 用户：资料修改、头像上传、用户搜索
- 社交：好友申请、好友列表、会话与历史消息、WebSocket 实时连接（一次性 ticket）
- 游戏：对局创建/接受/落子/认输、成绩提交、排行榜
- 计分房：创建/加入/结算、轮次提交、邀请令牌
- 工具：`/api/v1/tts/synthesize`、`/api/v1/translation/translate`、图片压缩状态、双色球历史、市场雷达快照、资讯 feed、资源搜索与结果解析
- 阅读：书籍/章节/书签/书架/进度，管理员导入、发布、隐藏与提供商同步
- 反馈：问题反馈与功能建议统一提交、状态处理、回复，以及消息中心系统通知
- 权限：功能可见列表、管理员配置功能角色与授权

## 部署

生产部署说明和阿里云 Ubuntu 22.04 模板见：

- `PRODUCTION_DEPLOY.md`
- `deploy/alicloud/ubuntu-22.04/README.md`
- `deploy/alicloud/ubuntu-22.04/bootstrap-server.sh`
- `deploy/alicloud/ubuntu-22.04/deploy-project.sh`

生产环境会把数据库、头像、反馈图片、JWT 密钥和收款码重定向到固定的共享数据目录，切换 release 时不会丢失数据；`AUTH_JWT_SECRET` 或密钥文件一旦更换，现有登录令牌会全部失效。
