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

IFS= read -r tinypng_api_key
if [[ -z "$tinypng_api_key" ]]; then
  echo "TINYPNG_API_KEY is empty." >&2
  exit 1
fi

temp_file="$(mktemp "${env_file}.tmp.XXXXXX")"
trap 'rm -f "$temp_file"' EXIT

key_written=0
while IFS= read -r line || [[ -n "$line" ]]; do
  if [[ "$line" == TINYPNG_API_KEY=* ]]; then
    printf 'TINYPNG_API_KEY=%s\n' "$tinypng_api_key" >>"$temp_file"
    key_written=1
  else
    printf '%s\n' "$line" >>"$temp_file"
  fi
done <"$env_file"

if [[ "$key_written" -eq 0 ]]; then
  printf '\nTINYPNG_API_KEY=%s\n' "$tinypng_api_key" >>"$temp_file"
fi

chown --reference="$env_file" "$temp_file"
chmod --reference="$env_file" "$temp_file"
mv -f "$temp_file" "$env_file"
trap - EXIT

echo "TinyPNG production secret configured."
