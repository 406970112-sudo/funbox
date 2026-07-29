#!/usr/bin/env bash

set -Eeuo pipefail

BRANCH="${BRANCH:-main}"
APP_ROOT="${APP_ROOT:-/srv/my-first-expo-app-current}"
APP_NAME="${APP_NAME:-my-first-expo-app}"
APP_USER="${APP_USER:-www-data}"
APP_GROUP="${APP_GROUP:-www-data}"
SKIP_GIT_UPDATE="${SKIP_GIT_UPDATE:-0}"
DEPLOY_COMMIT="${DEPLOY_COMMIT:-}"
BACKEND_SERVICE="${BACKEND_SERVICE:-my-first-expo-app-backend}"
BACKEND_PORT="${BACKEND_PORT:-3000}"
EMAIL_AGENT_SERVICE="${EMAIL_AGENT_SERVICE:-my-first-expo-app-email-agent}"
EMAIL_AGENT_PORT="${EMAIL_AGENT_PORT:-1234}"
GOPROXY="${GOPROXY:-https://goproxy.cn,direct}"
NPM_REGISTRY="${NPM_REGISTRY:-https://registry.npmmirror.com}"
FETCH_TIMEOUT_SECONDS="${FETCH_TIMEOUT_SECONDS:-120}"
FETCH_RETRIES="${FETCH_RETRIES:-5}"
FETCH_RETRY_DELAY_SECONDS="${FETCH_RETRY_DELAY_SECONDS:-15}"
BACKUP_ROOT="${BACKUP_ROOT:-/srv/deploy-backups}"

FRONTEND_ROOT="$APP_ROOT/frontend"
BACKEND_ROOT="$APP_ROOT/backend"
EMAIL_AGENT_ROOT="$APP_ROOT/email-agent/backend"
EMAIL_AGENT_FRONTEND_ROOT="$APP_ROOT/email-agent/frontend"
WEB_ROOT="/var/www/$APP_NAME/frontend"
EMAIL_AGENT_WEB_ROOT="$WEB_ROOT/email-agent"
BUILD_API="/tmp/$APP_NAME-api"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$BACKUP_ROOT/$TIMESTAMP"
DEPLOY_STARTED=false

log() {
  printf '\n[%s] %s\n' "$(date '+%F %T')" "$*"
}

retry() {
  local attempts="$1"
  local delay_seconds="$2"
  shift 2

  local attempt=1
  until "$@"; do
    if (( attempt >= attempts )); then
      return 1
    fi

    log "Command failed. Retrying in ${delay_seconds}s (${attempt}/${attempts}): $*"
    sleep "$delay_seconds"
    attempt=$((attempt + 1))
  done
}

install_backend_service() {
  local template="$APP_ROOT/deploy/alicloud/ubuntu-22.04/templates/my-first-expo-app-backend.service"
  local target="/etc/systemd/system/$BACKEND_SERVICE.service"

  if [[ ! -f "$template" ]]; then
    echo "Backend service template not found: $template"
    exit 1
  fi

  sed \
    -e "s#__APP_ROOT__#$APP_ROOT#g" \
    -e "s#__APP_USER__#$APP_USER#g" \
    -e "s#__APP_GROUP__#$APP_GROUP#g" \
    "$template" >"$target"
}

install_email_agent_service() {
  local template="$APP_ROOT/deploy/alicloud/ubuntu-22.04/templates/my-first-expo-app-email-agent.service"
  local target="/etc/systemd/system/$EMAIL_AGENT_SERVICE.service"

  if [[ ! -f "$template" ]]; then
    echo "Email agent service template not found: $template"
    exit 1
  fi

  sed \
    -e "s#__APP_ROOT__#$APP_ROOT#g" \
    -e "s#__APP_USER__#$APP_USER#g" \
    -e "s#__APP_GROUP__#$APP_GROUP#g" \
    -e "s#__EMAIL_AGENT_PORT__#$EMAIL_AGENT_PORT#g" \
    "$template" >"$target"

}

configure_nginx_api_proxies() {
  local configured=false
  local conf
  local tmp
  local stripped
  local has_agent
  local has_recipients
  local has_email_frontend
  local has_api
  local has_voice
  local has_health

  shopt -s nullglob
  for conf in /etc/nginx/sites-available/*.conf; do
    if ! grep -Fq "root $WEB_ROOT;" "$conf"; then
      continue
    fi

    tmp="$(mktemp)"
    stripped="$(mktemp)"
    awk '
      /# BEGIN my-first-expo-app email agent/ { skip = 1; next }
      /# END my-first-expo-app email agent/ { skip = 0; next }
      /# BEGIN my-first-expo-app api proxies/ { skip = 1; next }
      /# END my-first-expo-app api proxies/ { skip = 0; next }
      skip { next }
      { print }
    ' "$conf" >"$stripped"

    if grep -Eq '^[[:space:]]*location[[:space:]]*=[[:space:]]*/api/agent[[:space:]]*\{' "$stripped"; then
      has_agent=1
    else
      has_agent=0
    fi
    if grep -Eq '^[[:space:]]*location[[:space:]]*=[[:space:]]*/api/recipients[[:space:]]*\{' "$stripped"; then
      has_recipients=1
    else
      has_recipients=0
    fi
    if grep -Eq '^[[:space:]]*location[[:space:]]+/email-agent/[[:space:]]*\{' "$stripped"; then
      has_email_frontend=1
    else
      has_email_frontend=0
    fi
    if grep -Eq '^[[:space:]]*location[[:space:]]+/api/[[:space:]]*\{' "$stripped"; then
      has_api=1
    else
      has_api=0
    fi
    if grep -Eq '^[[:space:]]*location[[:space:]]+/voice/[[:space:]]*\{' "$stripped"; then
      has_voice=1
    else
      has_voice=0
    fi
    if grep -Eq '^[[:space:]]*location[[:space:]]*=[[:space:]]*/healthz[[:space:]]*\{' "$stripped"; then
      has_health=1
    else
      has_health=0
    fi

    awk \
      -v backend_port="$BACKEND_PORT" \
      -v email_port="$EMAIL_AGENT_PORT" \
      -v has_agent="$has_agent" \
      -v has_recipients="$has_recipients" \
      -v has_email_frontend="$has_email_frontend" \
      -v has_api="$has_api" \
      -v has_voice="$has_voice" \
      -v has_health="$has_health" '
      BEGIN {
        block = ""
        if (has_email_frontend != 1) {
          block = block \
                  "  location = /email-agent {\n" \
                  "    return 301 /email-agent/;\n" \
                  "  }\n\n" \
                  "  location /email-agent/ {\n" \
                  "    try_files $uri $uri/ /email-agent/index.html;\n" \
                  "  }\n\n"
        }
        if (has_agent != 1) {
          block = block \
                  "  location = /api/agent {\n" \
                  "    proxy_pass http://127.0.0.1:" email_port "/api/agent;\n" \
                  "    proxy_http_version 1.1;\n" \
                  "    proxy_set_header Host $host;\n" \
                  "    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n" \
                  "    proxy_set_header X-Forwarded-Proto $scheme;\n" \
                  "    proxy_read_timeout 300s;\n" \
                  "    proxy_send_timeout 300s;\n" \
                  "    proxy_buffering off;\n" \
                  "    proxy_cache off;\n" \
                  "  }\n\n"
        }
        if (has_recipients != 1) {
          block = block \
                  "  location = /api/recipients {\n" \
                  "    proxy_pass http://127.0.0.1:" email_port "/api/recipients;\n" \
                  "    proxy_http_version 1.1;\n" \
                  "    proxy_set_header Host $host;\n" \
                  "    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n" \
                  "    proxy_set_header X-Forwarded-Proto $scheme;\n" \
                  "  }\n\n"
        }
        if (has_api != 1) {
          block = block \
                  "  location /api/ {\n" \
                  "    proxy_pass http://127.0.0.1:" backend_port "/api/;\n" \
                  "    proxy_http_version 1.1;\n" \
                  "    proxy_set_header Host $host;\n" \
                  "    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n" \
                  "    proxy_set_header X-Forwarded-Proto $scheme;\n" \
                  "    proxy_read_timeout 300s;\n" \
                  "    proxy_send_timeout 300s;\n" \
                  "  }\n\n"
        }
        if (has_voice != 1) {
          block = block \
                  "  location /voice/ {\n" \
                  "    proxy_pass http://127.0.0.1:" backend_port "/voice/;\n" \
                  "    proxy_http_version 1.1;\n" \
                  "    proxy_set_header Host $host;\n" \
                  "    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n" \
                  "    proxy_set_header X-Forwarded-Proto $scheme;\n" \
                  "  }\n\n"
        }
        if (has_health != 1) {
          block = block \
                  "  location = /healthz {\n" \
                  "    proxy_pass http://127.0.0.1:" backend_port "/healthz;\n" \
                  "    proxy_http_version 1.1;\n" \
                  "    proxy_set_header Host $host;\n" \
                  "    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n" \
                  "    proxy_set_header X-Forwarded-Proto $scheme;\n" \
                  "  }\n\n"
        }
        if (block != "") {
          block = "  # BEGIN my-first-expo-app api proxies\n" block "  # END my-first-expo-app api proxies\n"
        }
      }
      /^[[:space:]]*location \/ \{/ && !inserted && block != "" {
        print block
        inserted = 1
      }
      { print }
      END {
        if (!inserted && block != "") {
          print block
        }
      }
    ' "$stripped" >"$tmp"
    cat "$tmp" >"$conf"
    rm -f "$tmp" "$stripped"
    configured=true
    log "Configured API proxies in $conf"
  done
  shopt -u nullglob

  if [[ "$configured" != true ]]; then
    log "No Nginx site with root $WEB_ROOT found. Skipping API proxy config."
  fi
}

rollback() {
  local exit_code=$?

  if [[ "$DEPLOY_STARTED" == true ]]; then
    log "Deployment failed. Restoring backup from $BACKUP_DIR"

    if [[ -f "$BACKUP_DIR/api" ]]; then
      install -m 755 "$BACKUP_DIR/api" "$BACKEND_ROOT/bin/api"
    fi

    if [[ -f "$BACKUP_DIR/$BACKEND_SERVICE.service" ]]; then
      cp -a "$BACKUP_DIR/$BACKEND_SERVICE.service" "/etc/systemd/system/$BACKEND_SERVICE.service"
    fi
    if [[ -f "$BACKUP_DIR/$EMAIL_AGENT_SERVICE.service" ]]; then
      cp -a "$BACKUP_DIR/$EMAIL_AGENT_SERVICE.service" "/etc/systemd/system/$EMAIL_AGENT_SERVICE.service"
    fi
    systemctl daemon-reload || true
    systemctl restart "$BACKEND_SERVICE" || true
    systemctl restart "$EMAIL_AGENT_SERVICE" || true

    if [[ -d "$BACKUP_DIR/frontend-dist" ]]; then
      rsync -a --delete "$BACKUP_DIR/frontend-dist/" "$WEB_ROOT/" || true
      chown -R "$APP_USER:$APP_GROUP" "$WEB_ROOT" || true
      systemctl reload nginx || true
    fi
  fi

  exit "$exit_code"
}

trap rollback ERR

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Please run this script with sudo or as root."
  exit 1
fi

if [[ "$SKIP_GIT_UPDATE" != "1" && ! -d "$APP_ROOT/.git" ]]; then
  echo "Git repository not found at $APP_ROOT."
  exit 1
fi

if [[ ! -f "$FRONTEND_ROOT/.env" || ! -f "$BACKEND_ROOT/.env" || ! -f "$EMAIL_AGENT_ROOT/.env" ]]; then
  echo "frontend/.env, backend/.env, and email-agent/backend/.env must already exist."
  exit 1
fi

cd "$APP_ROOT"

if [[ "$SKIP_GIT_UPDATE" == "1" ]]; then
  log "Skipping git update; source was synced by deployment workflow"
else
  if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
    echo "Tracked server files contain local changes. Commit or restore them before deploying:"
    git status --short --untracked-files=no
    exit 1
  fi

  log "Fetching origin/$BRANCH"
  retry "$FETCH_RETRIES" "$FETCH_RETRY_DELAY_SECONDS" timeout "$FETCH_TIMEOUT_SECONDS" git fetch origin "$BRANCH"
  git checkout "$BRANCH"
  git merge --ff-only "origin/$BRANCH"
fi

log "Building frontend"
pushd "$FRONTEND_ROOT" >/dev/null
# The repository currently uses npm workspaces and a frontend lock file that npm ci
# cannot consume reliably on the server. Do not modify the checked-in lock file.
npm install --package-lock=false --registry="$NPM_REGISTRY"
npx expo export --platform web
popd >/dev/null

log "Building backend"
export PATH="/usr/local/go/bin:$PATH"
export GOPROXY
pushd "$BACKEND_ROOT" >/dev/null
go build -buildvcs=false -o "$BUILD_API" ./cmd/api
popd >/dev/null

log "Building email agent"
pushd "$EMAIL_AGENT_ROOT" >/dev/null
npm install --registry="$NPM_REGISTRY"
npm run build
popd >/dev/null

log "Building email agent frontend"
pushd "$EMAIL_AGENT_FRONTEND_ROOT" >/dev/null
npm install --registry="$NPM_REGISTRY"
npm run build -- --base=/email-agent/
popd >/dev/null

log "Backing up current deployment to $BACKUP_DIR"
mkdir -p "$BACKUP_DIR"
[[ -f "$BACKEND_ROOT/bin/api" ]] && cp -a "$BACKEND_ROOT/bin/api" "$BACKUP_DIR/api"
[[ -d "$WEB_ROOT" ]] && cp -a "$WEB_ROOT" "$BACKUP_DIR/frontend-dist"
[[ -f "/etc/systemd/system/$BACKEND_SERVICE.service" ]] && cp -a "/etc/systemd/system/$BACKEND_SERVICE.service" "$BACKUP_DIR/$BACKEND_SERVICE.service"
[[ -f "/etc/systemd/system/$EMAIL_AGENT_SERVICE.service" ]] && cp -a "/etc/systemd/system/$EMAIL_AGENT_SERVICE.service" "$BACKUP_DIR/$EMAIL_AGENT_SERVICE.service"

DEPLOY_STARTED=true

log "Publishing frontend and backend"
mkdir -p "$BACKEND_ROOT/bin"
install -m 755 "$BUILD_API" "$BACKEND_ROOT/bin/api"
mkdir -p "$WEB_ROOT"
rsync -a --delete "$FRONTEND_ROOT/dist/" "$WEB_ROOT/"
mkdir -p "$EMAIL_AGENT_WEB_ROOT"
rsync -a --delete "$EMAIL_AGENT_FRONTEND_ROOT/dist/" "$EMAIL_AGENT_WEB_ROOT/"
chown -R "$APP_USER:$APP_GROUP" "$WEB_ROOT"

install_backend_service
install_email_agent_service
systemctl daemon-reload
systemctl enable "$BACKEND_SERVICE" "$EMAIL_AGENT_SERVICE"
systemctl restart "$BACKEND_SERVICE"
systemctl restart "$EMAIL_AGENT_SERVICE"
configure_nginx_api_proxies
nginx -t
systemctl reload nginx

log "Verifying deployment"
systemctl is-active --quiet "$BACKEND_SERVICE"
systemctl is-active --quiet "$EMAIL_AGENT_SERVICE"
systemctl is-active --quiet nginx
curl --fail --silent --show-error http://127.0.0.1:3000/healthz
if ! retry 10 2 curl --fail --silent --show-error "http://127.0.0.1:${EMAIL_AGENT_PORT}/api/"; then
  systemctl status --no-pager "$EMAIL_AGENT_SERVICE" || true
  journalctl -u "$EMAIL_AGENT_SERVICE" -n 80 --no-pager || true
  exit 1
fi
curl --fail --silent --show-error -X OPTIONS http://127.0.0.1/api/agent >/dev/null
curl --fail --silent --show-error http://127.0.0.1/api/recipients >/dev/null
curl --fail --silent --show-error http://127.0.0.1/api/v1/system/ping
curl --fail --silent --show-error --head http://127.0.0.1/email-agent/ >/dev/null
curl --fail --silent --show-error --head http://127.0.0.1/tools/live-stream-capture >/dev/null

DEPLOY_STARTED=false
trap - ERR

log "Deployment completed"
if [[ -n "$DEPLOY_COMMIT" ]]; then
  echo "Commit: ${DEPLOY_COMMIT:0:7}"
elif [[ -d "$APP_ROOT/.git" ]]; then
  echo "Commit: $(git rev-parse --short HEAD)"
fi
echo "Backup: $BACKUP_DIR"
echo "Frontend: $WEB_ROOT"
echo "Backend service: $BACKEND_SERVICE"
echo "Email agent service: $EMAIL_AGENT_SERVICE"
