# 阿里云 Ubuntu 22.04 一键上线版

这套模板适合当前仓库的部署方式：

- `frontend/` 作为 Expo Web 静态站点
- `backend/` 作为 Go API 服务
- 一台阿里云 ECS 同时部署前端和后端
- 用 Nginx 对外提供站点和反向代理

## 目录说明

- `bootstrap-server.sh`
  初始化服务器环境，安装 Nginx、Node.js、Go、Certbot 等依赖。
- `deploy-project.sh`
  拉代码、写环境变量、构建前端和后端、安装 `systemd` 与 Nginx 配置。
- `update-server.sh`
  日常更新脚本。保留现有环境变量与 Nginx 配置，只快进更新 `main`、构建、备份、发布并验证。
- `templates/my-first-expo-app-backend.service`
  后端 `systemd` 模板。
- `templates/app.example.com.conf`
  前端 Nginx 站点模板。
- `templates/api.example.com.conf`
  后端 Nginx 站点模板。

## 最短使用路径

### 1. 初始化服务器

```bash
sudo bash deploy/alicloud/ubuntu-22.04/bootstrap-server.sh
```

### 2. 一键部署项目

把下面的值替换成你自己的：

```bash
sudo \
REPO_URL='https://your.git.repo.git' \
BRANCH='main' \
APP_ROOT='/srv/my-first-expo-app' \
PERSISTENT_ROOT='/srv/my-first-expo-app-shared' \
APP_DOMAIN='app.example.com' \
API_DOMAIN='api.example.com' \
CORS_ALLOWED_ORIGINS='https://app.example.com,https://www.app.example.com' \
VOLC_APP_ID='your_app_id' \
VOLC_ACCESS_TOKEN='your_access_token' \
bash deploy/alicloud/ubuntu-22.04/deploy-project.sh
```

如果你需要覆盖更多配置，还可以额外传这些变量：

- `VOLC_RESOURCE_ID`
- `VOLC_ENDPOINT`
- `CORS_ALLOWED_ORIGINS`
- `SERVER_PORT`
- `RATE_LIMIT_WINDOW_MS`
- `RATE_LIMIT_MAX_REQUESTS`
- `MAX_REQUEST_BODY_BYTES`
- `TTS_MAX_TEXT_LENGTH`
- `TTS_MAX_CONTEXT_LENGTH`
- `TTS_REQUEST_TIMEOUT_MS`
- `STORAGE_AUDIO_DIR`
- `PERSISTENT_ROOT`
- `APP_USER`
- `APP_GROUP`
- `GOPROXY`

`PERSISTENT_ROOT` 必须是位于应用和 release 目录之外的绝对路径。部署脚本会把 SQLite 数据库、用户头像和 JWT 密钥保存到该目录；旧 `.env` 中的相对路径会自动改写为共享目录中的绝对路径。默认值为 `/srv/my-first-expo-app-shared`。

首次从 release 内的数据目录切换到共享目录时，更新脚本会通过 SQLite 在线备份迁移上一版数据库，并只复制数据库当前引用的头像与 JWT 密钥。迁移仅在共享数据库尚不存在时执行，后续发布不会覆盖已有共享数据。GitHub Actions 通过 `PREVIOUS_APP_ROOT=/srv/my-first-expo-app-current` 指定上一版应用目录。

### 3. 开 HTTPS

先把域名解析到 ECS 公网 IP，然后执行：

```bash
sudo certbot --nginx -d app.example.com -d api.example.com
```

## 部署完成后检查

后端服务状态：

```bash
sudo systemctl status my-first-expo-app-backend
```

查看后端日志：

```bash
sudo journalctl -u my-first-expo-app-backend -f
```

检查 Nginx：

```bash
sudo nginx -t
sudo systemctl status nginx
```

检查接口：

```bash
curl http://127.0.0.1:3000/healthz
curl https://api.example.com/healthz
```

## 日常更新 main 分支

代码合并并推送到远程 `main` 后，在云服务器执行：

```bash
sudo bash /srv/my-first-expo-app/deploy/alicloud/ubuntu-22.04/update-server.sh
```

脚本会自动：

1. 检查服务器是否存在未提交的已跟踪文件改动。
2. 使用 `git fetch` 和 `git merge --ff-only` 更新 `main`。
3. 保留现有的 `frontend/.env`、`backend/.env` 和 Nginx 配置。
4. 将账号数据路径固定到 `/srv/my-first-expo-app-shared`，并拒绝 release 目录内的持久化路径。
5. 共享数据库不存在时，从 `PREVIOUS_APP_ROOT` 自动迁移上一版数据库、当前头像和 JWT 密钥。
6. 重新构建 Expo Web 前端和 Go 后端。
7. 将当前线上前端和后端二进制备份到 `/srv/deploy-backups/`。
8. 发布新版本、重启后端、重载 Nginx 并执行健康检查。
9. 发布失败时自动恢复本次备份。

查看最近一次发布结果：

```bash
cd /srv/my-first-expo-app
git log -1 --oneline
systemctl status my-first-expo-app-backend --no-pager
curl http://127.0.0.1:3000/healthz
curl -I http://127.0.0.1/tools/live-stream-capture
```

如需更新其它分支：

```bash
sudo BRANCH=your-branch bash /srv/my-first-expo-app/deploy/alicloud/ubuntu-22.04/update-server.sh
```

## GitHub Actions 自动更新

仓库中的 `.github/workflows/deploy-main.yml` 会在代码推送到 `main` 后自动连接云服务器，并执行日常更新脚本。也可以在 GitHub 仓库的 Actions 页面手动触发。

在 GitHub 仓库的 `Settings > Secrets and variables > Actions` 中添加以下 Repository secrets：

- `DEPLOY_HOST`：云服务器公网 IP 或域名。
- `DEPLOY_PORT`：SSH 端口，通常为 `22`。
- `DEPLOY_USER`：用于部署的 SSH 用户。
- `DEPLOY_SSH_KEY`：部署用户对应的 SSH 私钥全文。
- `DEPLOY_KNOWN_HOSTS`：服务器 SSH 主机公钥记录，可在可信终端执行 `ssh-keyscan -H 服务器公网IP` 获取。

部署用户必须能够免密执行更新脚本需要的 `sudo` 命令。工作流会先快进更新服务器仓库，确保首次自动部署时也能获取最新的 `update-server.sh`。

## 绑定新域名并开启 HTTPS

先在 DNS 控制台将域名 A 记录解析到 ECS 公网 IP。解析生效后，在云服务器执行：

```bash
sudo bash /srv/my-first-expo-app/deploy/alicloud/ubuntu-22.04/setup-domain.sh xwhub.cn www.xwhub.cn
```

脚本会写入 Nginx 域名站点配置、保留摄像头和麦克风的 `Permissions-Policy` 响应头，并在 DNS 已指向当前 ECS 时自动使用 Certbot 签发 HTTPS 证书。
