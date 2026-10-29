#!/usr/bin/env bash

set -Eeuo pipefail

APP_ROOT="${APP_ROOT:-$(readlink -f /srv/my-first-expo-app-current)}"
if [[ -z "$APP_ROOT" || ! -f "$APP_ROOT/backend/go.mod" ]]; then
  echo "Current backend release was not found under $APP_ROOT" >&2
  exit 1
fi

cd "$APP_ROOT/backend"
/usr/local/go/bin/go build -o ./bin/api ./cmd/api
chown www-data:www-data ./bin/api
systemctl restart my-first-expo-app-backend.service
sleep 5
systemctl status my-first-expo-app-backend.service --no-pager || true
journalctl -u my-first-expo-app-backend.service -n 80 --no-pager || true
systemctl is-active my-first-expo-app-backend.service
