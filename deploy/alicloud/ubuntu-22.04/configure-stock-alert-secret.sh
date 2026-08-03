#!/usr/bin/env bash

set -Eeuo pipefail

CURRENT_ENV="/srv/my-first-expo-app-current/backend/.env"
LEGACY_ENV="/srv/my-first-expo-app/backend/.env"

if [[ -f "$CURRENT_ENV" ]]; then
  env_file="$CURRENT_ENV"
elif [[ -f "$LEGACY_ENV" ]]; then
  env_file="$LEGACY_ENV"
else
  echo "Production backend .env was not found." >&2
  exit 1
fi

IFS= read -r stock_alert_sendkey
if [[ -z "$stock_alert_sendkey" ]]; then
  echo "STOCK_ALERT_SENDKEY is empty." >&2
  exit 1
fi

temp_file="$(mktemp "${env_file}.tmp.XXXXXX")"
trap 'rm -f "$temp_file"' EXIT

sendkey_written=0
enabled_written=0
while IFS= read -r line || [[ -n "$line" ]]; do
  if [[ "$line" == STOCK_ALERT_SENDKEY=* ]]; then
    printf 'STOCK_ALERT_SENDKEY=%s\n' "$stock_alert_sendkey" >>"$temp_file"
    sendkey_written=1
  elif [[ "$line" == STOCK_ALERT_ENABLED=* ]]; then
    printf 'STOCK_ALERT_ENABLED=true\n' >>"$temp_file"
    enabled_written=1
  else
    printf '%s\n' "$line" >>"$temp_file"
  fi
done <"$env_file"

if [[ "$sendkey_written" -eq 0 ]]; then
  printf 'STOCK_ALERT_SENDKEY=%s\n' "$stock_alert_sendkey" >>"$temp_file"
fi
if [[ "$enabled_written" -eq 0 ]]; then
  printf 'STOCK_ALERT_ENABLED=true\n' >>"$temp_file"
fi

chown --reference="$env_file" "$temp_file"
chmod --reference="$env_file" "$temp_file"
mv -f "$temp_file" "$env_file"
trap - EXIT

echo "Stock alert production secret configured."
