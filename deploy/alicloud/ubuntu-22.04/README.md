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
- `DEEPSEEK_STOCK_MODEL`
- `STOCK_ALERT_ENABLED`
- `STOCK_ALERT_SENDKEY`
- `STOCK_ALERT_SECRET`
- `STOCK_ALERT_MONITOR_INTERVAL_MS`
- `STOCK_ALERT_QUOTE_MAX_AGE_MS`
- `STOCK_ALERT_MAX_WATCH_PER_USER`
- `STOCK_ALERT_ANALYSIS_DAILY_LIMIT`
- `STOCK_ALERT_MIN_KLINES`
- `SERVER_PORT`
- `RATE_LIMIT_WINDOW_MS`
- `RATE_LIMIT_MAX_REQUESTS`
- `MAX_REQUEST_BODY_BYTES`
- `TTS_MAX_TEXT_LENGTH`
- `TTS_MAX_CONTEXT_LENGTH`
- `TTS_REQUEST_TIMEOUT_MS`
- `STORAGE_AUDIO_DIR`
- `STORAGE_FEEDBACK_DIR`
- `STORAGE_PAYMENT_QR_DIR`
- `PERSISTENT_ROOT`
- `APP_USER`
- `APP_GROUP`
- `GOPROXY`

`PERSISTENT_ROOT` 必须是位于应用和 release 目录之外的绝对路径。部署脚本会把 SQLite 数据库、用户头像、反馈图片、JWT 密钥和收款码保存到该目录；旧 `.env` 中的相对路径会自动改写为共享目录中的绝对路径。默认值为 `/srv/my-first-expo-app-shared`。

首次从 release 内的数据目录切换到共享目录时，更新脚本会通过 SQLite 在线备份迁移上一版数据库，并复制数据库当前引用的头像、JWT 密钥、反馈图片与收款码。迁移仅在共享数据库尚不存在时执行，后续发布不会覆盖已有共享数据。GitHub Actions 通过 `PREVIOUS_APP_ROOT=/srv/my-first-expo-app-current` 指定上一版应用目录。

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
sudo PUBLIC_FRONTEND_URL=https://www.xwhub.cn \
  bash /srv/my-first-expo-app/deploy/alicloud/ubuntu-22.04/update-server.sh
```

脚本会自动：

1. 检查服务器是否存在未提交的已跟踪文件改动。
2. 使用 `git fetch` 和 `git merge --ff-only` 更新 `main`。
3. 保留现有的 `frontend/.env`、`backend/.env` 和 Nginx 配置。
4. 将账号数据路径固定到 `/srv/my-first-expo-app-shared`，并拒绝 release 目录内的持久化路径。
5. 共享数据库不存在时，从 `PREVIOUS_APP_ROOT` 自动迁移上一版数据库、当前头像和 JWT 密钥。
6. 重新构建 Expo Web 前端和 Go 后端。
7. 将当前线上前端和后端二进制备份到 `/srv/deploy-backups/`。
8. 先发布哈希资源，再原子替换 HTML，最后发布版本标记并重载 Nginx。
9. 校验本机与公网 HTML、`version.json` 和入口资源都属于本次提交。
10. 发布失败时自动恢复本次备份。

查看最近一次发布结果：

```bash
cd /srv/my-first-expo-app
git log -1 --oneline
systemctl status my-first-expo-app-backend --no-pager
curl http://127.0.0.1:3000/healthz
curl -I http://127.0.0.1/tools/live-stream-capture
curl https://www.xwhub.cn/version.json
```

`version.json` 和 HTML 中的 `funbox-build-commit` 应等于本次部署提交。HTML 与 `version.json` 使用 `Cache-Control: no-store`，带哈希的 `/_expo/static/` 和 `/assets/` 资源继续使用长期 immutable 缓存。

生产页面会在加载、前台恢复和低频轮询时检查新版本。发现新版本后，前台停留时显示更新提示；切回前台或发生路由切换时自动重新加载。`verify-production-release.mjs` 可在本地手动检查线上版本：

```bash
node deploy/alicloud/ubuntu-22.04/verify-production-release.mjs \
  https://www.xwhub.cn \
  "$(git rev-parse HEAD)"
node --test deploy/alicloud/ubuntu-22.04/tests/verify-production-release.test.mjs
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
- `STOCK_ALERT_SENDKEY`：Server酱 SendKey，用于股票交易提醒的微信推送；在 `Settings > Secrets and variables > Actions` 中配置后，每次部署会自动写入服务器 `backend/.env`。

部署用户必须能够免密执行更新脚本需要的 `sudo` 命令。工作流通过 `create-source-archive.sh` 打包当前提交中已跟踪的前端、Go 后端、邮件智能体、部署脚本及根目录 npm 配置，再上传到服务器构建。设计文档、设计脚本、小程序、独立邮件后端副本和未跟踪的本地文件不进入部署包。

源码同步步骤最多运行 10 分钟，每次上传最多运行 180 秒，失败后最多尝试 3 次，避免源码传输占满整个部署的 30 分钟预算。日志会记录部署包大小及上传耗时。

本地检查部署包内容：

```bash
bash deploy/alicloud/ubuntu-22.04/tests/create-source-archive.test.sh
```

发布后会通过 `wait-for-service.sh` 等待后端和邮件智能体的 HTTP 接口就绪，每个服务最多探测 30 次，失败后间隔 2 秒重试；单次连接最多等待 2 秒，响应最多等待 5 秒。最终失败时输出对应服务状态及最近 80 条日志，再触发回滚，避免把进程已启动误认为接口已就绪。

本地检查服务就绪等待：

```bash
node --test deploy/alicloud/ubuntu-22.04/tests/wait-for-service.test.mjs
```

## 绑定新域名并开启 HTTPS

先在 DNS 控制台将域名 A 记录解析到 ECS 公网 IP。解析生效后，在云服务器执行：

```bash
sudo bash /srv/my-first-expo-app/deploy/alicloud/ubuntu-22.04/setup-domain.sh xwhub.cn www.xwhub.cn
```

脚本会写入 Nginx 域名站点配置、保留摄像头和麦克风的 `Permissions-Policy` 响应头，并在 DNS 已指向当前 ECS 时自动使用 Certbot 签发 HTTPS 证书。
