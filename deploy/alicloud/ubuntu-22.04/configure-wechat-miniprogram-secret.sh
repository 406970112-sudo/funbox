#!/usr/bin/env bash

set -Eeuo pipefail

CURRENT_ENV="/srv/my-first-expo-app-current/backend/.env"
LEGACY_ENV="/srv/my-first-expo-app/backend/.env"
APP_ID="wx1c056466c78d8934"
APP_GROUP="${APP_GROUP:-www-data}"

if [[ -f "$CURRENT_ENV" ]]; then
  env_file="$CURRENT_ENV"
elif [[ -f "$LEGACY_ENV" ]]; then
  env_file="$LEGACY_ENV"
else
  echo "Production backend .env was not found." >&2
  exit 1
fi

IFS= read -r app_secret
if [[ -z "$app_secret" ]]; then
  echo "WECHAT_MINIPROGRAM_APP_SECRET is empty." >&2
  exit 1
fi

temp_file="$(mktemp "${env_file}.tmp.XXXXXX")"
trap 'rm -f "$temp_file"' EXIT

app_id_written=0
app_secret_written=0
while IFS= read -r line || [[ -n "$line" ]]; do
  case "$line" in
    WECHAT_MINIPROGRAM_APP_ID=*)
      printf 'WECHAT_MINIPROGRAM_APP_ID=%s\n' "$APP_ID" >>"$temp_file"
      app_id_written=1
      ;;
    WECHAT_MINIPROGRAM_APP_SECRET=*)
      printf 'WECHAT_MINIPROGRAM_APP_SECRET=%s\n' "$app_secret" >>"$temp_file"
      app_secret_written=1
      ;;
    *)
      printf '%s\n' "$line" >>"$temp_file"
      ;;
  esac
done <"$env_file"

if [[ "$app_id_written" -eq 0 ]]; then
  printf '\nWECHAT_MINIPROGRAM_APP_ID=%s\n' "$APP_ID" >>"$temp_file"
fi
if [[ "$app_secret_written" -eq 0 ]]; then
  printf 'WECHAT_MINIPROGRAM_APP_SECRET=%s\n' "$app_secret" >>"$temp_file"
fi

chown root:"$APP_GROUP" "$temp_file"
chmod 640 "$temp_file"
mv -f "$temp_file" "$env_file"
trap - EXIT

echo "WeChat mini program production secret configured."
