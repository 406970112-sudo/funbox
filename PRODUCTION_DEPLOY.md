# 生产部署说明

## 当前推荐结构

这个项目现在建议按下面的结构部署：

- `frontend/`
  Expo 前端项目
- `backend/`
  Go 后端项目

你不需要拆成两个仓库，但建议部署时把它们当成两套服务：

- 前端负责页面和交互
- 后端负责 API、TTS、鉴权、数据库和后续业务能力

## 目录建议

- `frontend/app`
  前端页面
- `frontend/components`
  前端组件
- `backend/cmd/api`
  Go 服务启动入口
- `backend/internal/config`
  环境变量和配置加载
- `backend/internal/httpapi`
  HTTP 服务和通用中间件
- `backend/internal/tts`
  TTS 业务模块

后续新增业务时，推荐继续按这个思路扩展：

- `backend/internal/auth`
- `backend/internal/user`
- `backend/internal/order`
- `backend/internal/task`
- `backend/internal/storage`

## 1. 环境变量

前端环境变量在：

```text
frontend/.env
```

示例参考：

[frontend/.env.example](c:/Users/Administrator/Desktop/my-first-expo-app/frontend/.env.example)

当前前端至少需要：

```env
EXPO_PUBLIC_VOICE_SERVER_URL=https://api.example.com
```

Go 后端环境变量在：

```text
backend/.env
```

示例参考：

[backend/.env.example](c:/Users/Administrator/Desktop/my-first-expo-app/backend/.env.example)

## 2. 本地启动

启动前端：

```bash
cd frontend
npm install
npm run web
```

启动后端：

```bash
cd backend
cp .env.example .env
go mod tidy
go run ./cmd/api
```

后端健康检查接口：

```bash
GET /healthz
GET /api/v1/system/ping
```

当前兼容的 TTS 接口：

```bash
POST /api/v1/tts/synthesize
POST /api/synthesize
```

保留 `/api/synthesize` 是为了兼容当前前端请求，不需要你立刻再改一轮接口地址。

## 3. 生产部署建议

推荐结构：

1. 一台 Linux 服务器即可。
2. 前端构建后作为静态资源部署。
3. Go 后端单独跑一个进程。
4. 用 Nginx 或 Caddy 做 HTTPS 反向代理。

常见域名方式有两种：

- `https://app.example.com` 给前端
- `https://api.example.com` 给后端

或者：

- `https://example.com` 给前端
- `https://example.com/api/` 转发给后端

## 4. Nginx 示例

```nginx
server {
  listen 80;
  server_name api.example.com;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 75s;
    proxy_send_timeout 75s;
  }
}
```

如果前端也放同一台服务器，可以再单独配一个前端站点。

## 5. 当前已经具备的能力

- 前端和后端目录已拆开
- 后端密钥不再暴露给前端
- Go 后端统一负责第三方调用
- 基础跨域白名单
- 基础限流
- 请求大小限制
- 文本长度限制
- 健康检查接口
- SQLite 用户数据库和自动建表
- 用户名密码注册登录与 JWT 鉴权
- 昵称、头像和密码修改
- 本地头像文件存储
- 本地音频文件落盘
- 兼容旧的 `/api/synthesize` 路由

## 6. 下一步最值得补的内容

如果你准备正式对外提供服务，推荐优先补：

- `/srv/my-first-expo-app-shared/data/` 定期备份
- 邮箱验证和密码找回
- 用户量增长后迁移到 PostgreSQL 和对象存储
- 日志和监控
- 自动化部署

## 7. 阿里云 Ubuntu 22.04 一键上线版

仓库里已经补了一套可直接复用的部署模板，位置在：

- [deploy/alicloud/ubuntu-22.04/README.md](c:/Users/Administrator/Desktop/my-first-expo-app/deploy/alicloud/ubuntu-22.04/README.md)
- [deploy/alicloud/ubuntu-22.04/bootstrap-server.sh](c:/Users/Administrator/Desktop/my-first-expo-app/deploy/alicloud/ubuntu-22.04/bootstrap-server.sh)
- [deploy/alicloud/ubuntu-22.04/deploy-project.sh](c:/Users/Administrator/Desktop/my-first-expo-app/deploy/alicloud/ubuntu-22.04/deploy-project.sh)
