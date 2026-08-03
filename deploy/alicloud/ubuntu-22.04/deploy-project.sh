#!/usr/bin/env bash

set -euo pipefail

REPO_URL="${REPO_URL:-}"
BRANCH="${BRANCH:-main}"
APP_ROOT="${APP_ROOT:-/srv/my-first-expo-app}"
APP_NAME="${APP_NAME:-my-first-expo-app}"
APP_DOMAIN="${APP_DOMAIN:-}"
API_DOMAIN="${API_DOMAIN:-}"
CORS_ALLOWED_ORIGINS="${CORS_ALLOWED_ORIGINS:-https://$APP_DOMAIN}"
APP_USER="${APP_USER:-www-data}"
APP_GROUP="${APP_GROUP:-www-data}"
SERVER_PORT="${SERVER_PORT:-3000}"
GOPROXY="${GOPROXY:-https://goproxy.cn,direct}"
NPM_REGISTRY="${NPM_REGISTRY:-https://registry.npmmirror.com}"
PERSISTENT_ROOT="${PERSISTENT_ROOT:-/srv/my-first-expo-app-shared}"

VOLC_APP_ID="${VOLC_APP_ID:-}"
VOLC_ACCESS_TOKEN="${VOLC_ACCESS_TOKEN:-}"
VOLC_RESOURCE_ID="${VOLC_RESOURCE_ID:-}"
VOLC_ENDPOINT="${VOLC_ENDPOINT:-wss://openspeech.bytedance.com/api/v3/tts/unidirectional/stream}"

DEEPSEEK_STOCK_MODEL="${DEEPSEEK_STOCK_MODEL:-deepseek-v4-flash}"
STOCK_ALERT_ENABLED="${STOCK_ALERT_ENABLED:-false}"
STOCK_ALERT_SENDKEY="${STOCK_ALERT_SENDKEY:-}"
STOCK_ALERT_SECRET="${STOCK_ALERT_SECRET:-funbox-stock-alert-secret}"
STOCK_ALERT_MONITOR_INTERVAL_MS="${STOCK_ALERT_MONITOR_INTERVAL_MS:-10000}"
STOCK_ALERT_QUOTE_MAX_AGE_MS="${STOCK_ALERT_QUOTE_MAX_AGE_MS:-15000}"
STOCK_ALERT_MAX_WATCH_PER_USER="${STOCK_ALERT_MAX_WATCH_PER_USER:-10}"
STOCK_ALERT_ANALYSIS_DAILY_LIMIT="${STOCK_ALERT_ANALYSIS_DAILY_LIMIT:-10}"
STOCK_ALERT_MIN_KLINES="${STOCK_ALERT_MIN_KLINES:-60}"

RATE_LIMIT_WINDOW_MS="${RATE_LIMIT_WINDOW_MS:-900000}"
RATE_LIMIT_MAX_REQUESTS="${RATE_LIMIT_MAX_REQUESTS:-30}"
MAX_REQUEST_BODY_BYTES="${MAX_REQUEST_BODY_BYTES:-65536}"
TTS_MAX_TEXT_LENGTH="${TTS_MAX_TEXT_LENGTH:-5000}"
TTS_MAX_CONTEXT_LENGTH="${TTS_MAX_CONTEXT_LENGTH:-1000}"
TTS_REQUEST_TIMEOUT_MS="${TTS_REQUEST_TIMEOUT_MS:-120000}"
STORAGE_AUDIO_DIR="${STORAGE_AUDIO_DIR:-voice}"
STORAGE_AVATAR_DIR="${STORAGE_AVATAR_DIR:-data/avatars}"
STORAGE_MAX_AVATAR_BYTES="${STORAGE_MAX_AVATAR_BYTES:-3145728}"
STORAGE_FEEDBACK_DIR="${STORAGE_FEEDBACK_DIR:-data/feedback-images}"
STORAGE_MAX_FEEDBACK_IMAGE_BYTES="${STORAGE_MAX_FEEDBACK_IMAGE_BYTES:-5242880}"
STORAGE_MAX_FEEDBACK_IMAGES="${STORAGE_MAX_FEEDBACK_IMAGES:-3}"
STORAGE_PAYMENT_QR_DIR="${STORAGE_PAYMENT_QR_DIR:-data/payment-qr}"
STORAGE_MAX_PAYMENT_QR_BYTES="${STORAGE_MAX_PAYMENT_QR_BYTES:-2097152}"
DATABASE_PATH="${DATABASE_PATH:-data/app.db}"
AUTH_JWT_SECRET_FILE="${AUTH_JWT_SECRET_FILE:-data/jwt-secret}"
AUTH_TOKEN_TTL_MS="${AUTH_TOKEN_TTL_MS:-604800000}"

resolve_persistent_path() {
  local configured_path="$1"
  local default_path="$2"

  configured_path="${configured_path:-$default_path}"
  if [[ "$configured_path" == /* ]]; then
    realpath -m "$configured_path"
  else
    realpath -m "$PERSISTENT_ROOT/$configured_path"
  fi
}

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Please run this script with sudo or as root."
  exit 1
fi

if [[ -z "$APP_DOMAIN" || -z "$API_DOMAIN" ]]; then
  echo "APP_DOMAIN and API_DOMAIN are required."
  exit 1
fi

if [[ -z "$VOLC_APP_ID" || -z "$VOLC_ACCESS_TOKEN" ]]; then
  echo "VOLC_APP_ID and VOLC_ACCESS_TOKEN are required."
  exit 1
fi

if [[ "$PERSISTENT_ROOT" != /* ]]; then
  echo "PERSISTENT_ROOT must be an absolute path."
  exit 1
fi

PERSISTENT_ROOT="$(realpath -m "$PERSISTENT_ROOT")"
RESOLVED_APP_ROOT="$(realpath -m "$APP_ROOT")"
case "$PERSISTENT_ROOT" in
  /|"$RESOLVED_APP_ROOT"|"$RESOLVED_APP_ROOT"/*|/srv/my-first-expo-app-releases|/srv/my-first-expo-app-releases/*)
    echo "PERSISTENT_ROOT must be outside the application and release directories."
    exit 1
    ;;
esac

STORAGE_AVATAR_DIR="$(resolve_persistent_path "$STORAGE_AVATAR_DIR" "data/avatars")"
STORAGE_FEEDBACK_DIR="$(resolve_persistent_path "$STORAGE_FEEDBACK_DIR" "data/feedback-images")"
STORAGE_PAYMENT_QR_DIR="$(resolve_persistent_path "$STORAGE_PAYMENT_QR_DIR" "data/payment-qr")"
DATABASE_PATH="$(resolve_persistent_path "$DATABASE_PATH" "data/app.db")"
AUTH_JWT_SECRET_FILE="$(resolve_persistent_path "$AUTH_JWT_SECRET_FILE" "data/jwt-secret")"

for path in "$STORAGE_AVATAR_DIR" "$STORAGE_FEEDBACK_DIR" "$STORAGE_PAYMENT_QR_DIR" "$DATABASE_PATH" "$AUTH_JWT_SECRET_FILE"; do
  case "$path" in
    "$PERSISTENT_ROOT"/*) ;;
    *)
      echo "Auth storage paths must resolve inside $PERSISTENT_ROOT."
      exit 1
      ;;
  esac
done

if [[ ! -d "$APP_ROOT/.git" ]]; then
  if [[ -z "$REPO_URL" ]]; then
    echo "REPO_URL is required when APP_ROOT does not contain a git repository."
    exit 1
  fi

  mkdir -p "$(dirname "$APP_ROOT")"
  git clone -b "$BRANCH" "$REPO_URL" "$APP_ROOT"
else
  git -C "$APP_ROOT" fetch --all --prune
  git -C "$APP_ROOT" checkout "$BRANCH"
  git -C "$APP_ROOT" pull --ff-only origin "$BRANCH"
fi

mkdir -p "$APP_ROOT/backend/$STORAGE_AUDIO_DIR"
install -d -o "$APP_USER" -g "$APP_GROUP" -m 750 "$PERSISTENT_ROOT"
install -d -o "$APP_USER" -g "$APP_GROUP" -m 755 "$STORAGE_AVATAR_DIR"
install -d -o "$APP_USER" -g "$APP_GROUP" -m 750 "$STORAGE_FEEDBACK_DIR"
install -d -o "$APP_USER" -g "$APP_GROUP" -m 750 "$STORAGE_PAYMENT_QR_DIR"
install -d -o "$APP_USER" -g "$APP_GROUP" -m 750 "$(dirname "$DATABASE_PATH")"
install -d -o "$APP_USER" -g "$APP_GROUP" -m 750 "$(dirname "$AUTH_JWT_SECRET_FILE")"
mkdir -p "/var/www/$APP_NAME"

cat >"$APP_ROOT/backend/.env" <<EOF
APP_ENV=production
SERVER_HOST=0.0.0.0
SERVER_PORT=$SERVER_PORT
SERVER_PUBLIC_BASE_URL=https://$API_DOMAIN
CORS_ALLOWED_ORIGINS=$CORS_ALLOWED_ORIGINS

STORAGE_AUDIO_DIR=$STORAGE_AUDIO_DIR
STORAGE_AVATAR_DIR=$STORAGE_AVATAR_DIR
STORAGE_MAX_AVATAR_BYTES=$STORAGE_MAX_AVATAR_BYTES
STORAGE_FEEDBACK_DIR=$STORAGE_FEEDBACK_DIR
STORAGE_MAX_FEEDBACK_IMAGE_BYTES=$STORAGE_MAX_FEEDBACK_IMAGE_BYTES
STORAGE_MAX_FEEDBACK_IMAGES=$STORAGE_MAX_FEEDBACK_IMAGES
STORAGE_PAYMENT_QR_DIR=$STORAGE_PAYMENT_QR_DIR
STORAGE_MAX_PAYMENT_QR_BYTES=$STORAGE_MAX_PAYMENT_QR_BYTES

PERSISTENT_ROOT=$PERSISTENT_ROOT
DATABASE_PATH=$DATABASE_PATH
AUTH_JWT_SECRET_FILE=$AUTH_JWT_SECRET_FILE
AUTH_TOKEN_TTL_MS=$AUTH_TOKEN_TTL_MS

RATE_LIMIT_WINDOW_MS=$RATE_LIMIT_WINDOW_MS
RATE_LIMIT_MAX_REQUESTS=$RATE_LIMIT_MAX_REQUESTS
MAX_REQUEST_BODY_BYTES=$MAX_REQUEST_BODY_BYTES

TTS_MAX_TEXT_LENGTH=$TTS_MAX_TEXT_LENGTH
TTS_MAX_CONTEXT_LENGTH=$TTS_MAX_CONTEXT_LENGTH
TTS_REQUEST_TIMEOUT_MS=$TTS_REQUEST_TIMEOUT_MS

VOLC_APP_ID=$VOLC_APP_ID
VOLC_ACCESS_TOKEN=$VOLC_ACCESS_TOKEN
VOLC_RESOURCE_ID=$VOLC_RESOURCE_ID
VOLC_ENDPOINT=$VOLC_ENDPOINT

DEEPSEEK_STOCK_MODEL=$DEEPSEEK_STOCK_MODEL
STOCK_ALERT_ENABLED=$STOCK_ALERT_ENABLED
STOCK_ALERT_SENDKEY=$STOCK_ALERT_SENDKEY
STOCK_ALERT_SECRET=$STOCK_ALERT_SECRET
STOCK_ALERT_MONITOR_INTERVAL_MS=$STOCK_ALERT_MONITOR_INTERVAL_MS
STOCK_ALERT_QUOTE_MAX_AGE_MS=$STOCK_ALERT_QUOTE_MAX_AGE_MS
STOCK_ALERT_MAX_WATCH_PER_USER=$STOCK_ALERT_MAX_WATCH_PER_USER
STOCK_ALERT_ANALYSIS_DAILY_LIMIT=$STOCK_ALERT_ANALYSIS_DAILY_LIMIT
STOCK_ALERT_MIN_KLINES=$STOCK_ALERT_MIN_KLINES
EOF

cat >"$APP_ROOT/frontend/.env" <<EOF
EXPO_PUBLIC_API_BASE_URL=https://$API_DOMAIN
EXPO_PUBLIC_VOICE_SERVER_URL=https://$API_DOMAIN
EOF

chown root:"$APP_GROUP" "$APP_ROOT/backend/.env"
chmod 640 "$APP_ROOT/backend/.env"

export PATH="/usr/local/go/bin:$PATH"
export GOPROXY

pushd "$APP_ROOT/backend" >/dev/null
go mod tidy
go build -o ./bin/api ./cmd/api
popd >/dev/null

pushd "$APP_ROOT/frontend" >/dev/null
npm install --registry="$NPM_REGISTRY"
npx expo export --platform web
popd >/dev/null

rsync -av --delete "$APP_ROOT/frontend/dist/" "/var/www/$APP_NAME/frontend/"

install -d -m 755 /etc/my-first-expo-app

sed \
  -e "s|__APP_ROOT__|$APP_ROOT|g" \
  -e "s|__APP_USER__|$APP_USER|g" \
  -e "s|__APP_GROUP__|$APP_GROUP|g" \
  -e "s|__SERVER_PORT__|$SERVER_PORT|g" \
  "$APP_ROOT/deploy/alicloud/ubuntu-22.04/templates/my-first-expo-app-backend.service" \
  >/etc/systemd/system/my-first-expo-app-backend.service

sed \
  -e "s|__APP_DOMAIN__|$APP_DOMAIN|g" \
  -e "s|__APP_NAME__|$APP_NAME|g" \
  "$APP_ROOT/deploy/alicloud/ubuntu-22.04/templates/app.example.com.conf" \
  >/etc/nginx/sites-available/$APP_DOMAIN.conf

sed \
  -e "s|__API_DOMAIN__|$API_DOMAIN|g" \
  -e "s|__SERVER_PORT__|$SERVER_PORT|g" \
  "$APP_ROOT/deploy/alicloud/ubuntu-22.04/templates/api.example.com.conf" \
  >/etc/nginx/sites-available/$API_DOMAIN.conf

ln -sf "/etc/nginx/sites-available/$APP_DOMAIN.conf" "/etc/nginx/sites-enabled/$APP_DOMAIN.conf"
ln -sf "/etc/nginx/sites-available/$API_DOMAIN.conf" "/etc/nginx/sites-enabled/$API_DOMAIN.conf"
rm -f /etc/nginx/sites-enabled/default

chown -R "$APP_USER:$APP_GROUP" "$APP_ROOT/backend/$STORAGE_AUDIO_DIR"
chown -R "$APP_USER:$APP_GROUP" "$PERSISTENT_ROOT"
chown -R "$APP_USER:$APP_GROUP" "/var/www/$APP_NAME/frontend"

systemctl daemon-reload
systemctl enable my-first-expo-app-backend
systemctl restart my-first-expo-app-backend

nginx -t
systemctl restart nginx

echo "Deployment completed."
echo "Frontend: http://$APP_DOMAIN"
echo "Backend:  http://$API_DOMAIN"
echo "Next step: run certbot for HTTPS."
