#!/usr/bin/env bash

set -Eeuo pipefail

APP_ROOT="${APP_ROOT:-$(readlink -f /srv/my-first-expo-app-current)}"
if [[ -z "$APP_ROOT" || ! -f "$APP_ROOT/backend/go.mod" ]]; then
  echo "Current backend release was not found under $APP_ROOT" >&2
  exit 1
fi

cd "$APP_ROOT/backend"
SERVICE_USER="$(systemctl show -p User --value my-first-expo-app-backend.service)"
SERVICE_GROUP="$(systemctl show -p Group --value my-first-expo-app-backend.service)"
SERVICE_USER="${SERVICE_USER:-www-data}"
SERVICE_GROUP="${SERVICE_GROUP:-www-data}"
printf 'service user=%s group=%s\n' "$SERVICE_USER" "$SERVICE_GROUP"
chown "$SERVICE_USER:$SERVICE_GROUP" .env
chmod 640 .env
if ! runuser -u "$SERVICE_USER" -- test -r .env; then
  echo "Backend environment file is not readable by $SERVICE_USER" >&2
  exit 1
fi
install -d -o "$SERVICE_USER" -g "$SERVICE_GROUP" -m 755 data
/usr/local/go/bin/go build -o ./bin/api ./cmd/api
chown "$SERVICE_USER:$SERVICE_GROUP" ./bin/api
systemctl restart my-first-expo-app-backend.service
sleep 5
systemctl status my-first-expo-app-backend.service --no-pager || true
journalctl -u my-first-expo-app-backend.service -n 80 --no-pager || true
systemctl is-active my-first-expo-app-backend.service
