#!/usr/bin/env bash

set -Eeuo pipefail

app_root="${1:?APP_ROOT is required}"
current_root="${2:-/srv/my-first-expo-app-current}"
legacy_root="${3:-/srv/my-first-expo-app}"

resolved_path() {
  local path="$1"
  if [[ -e "$path" ]]; then
    realpath "$path"
  else
    printf '%s/%s\n' "$(cd "$(dirname "$path")" && pwd -P)" "$(basename "$path")"
  fi
}

file_mtime() {
  stat -c '%Y' "$1" 2>/dev/null || stat -f '%m' "$1"
}

copy_env() {
  local source="$1"
  local target="$2"
  local fallback="$3"
  local label="$4"

  if [[ -f "$source" ]]; then
    if [[ "$(resolved_path "$source")" == "$(resolved_path "$target")" ]]; then
      printf '%s env already points at the target file; kept as-is.\n' "$label"
      return
    fi
    cp "$source" "$target"
    printf '%s env copied from %s.\n' "$label" "$source"
    return
  fi

  if [[ ! -f "$target" && -n "$fallback" && -f "$fallback" ]]; then
    cp "$fallback" "$target"
    printf '%s env copied from legacy %s.\n' "$label" "$fallback"
    return
  fi

  printf '%s env already exists; kept as-is.\n' "$label"
}

copy_env \
  "$current_root/frontend/.env" \
  "$app_root/frontend/.env" \
  "$legacy_root/frontend/.env" \
  "frontend"

copy_env \
  "$current_root/backend/.env" \
  "$app_root/backend/.env" \
  "$legacy_root/backend/.env" \
  "backend"

target_email_env="$app_root/email-agent/backend/.env"
email_candidates="$(
  for root in "$current_root" "$legacy_root" /srv/my-first-expo-app-releases; do
    [[ -d "$root" ]] || continue
    while IFS= read -r path; do
      printf '%s %s\n' "$(file_mtime "$path")" "$path"
    done < <(find "$root" -path '*/email-agent/backend/.env' -type f -print 2>/dev/null)
  done | sort -nr
)"
email_env=""
while read -r _ path; do
  [[ -n "${path:-}" ]] || continue
  if [[ "$(resolved_path "$path")" != "$(resolved_path "$target_email_env")" ]]; then
    email_env="$path"
    break
  fi
done <<<"$email_candidates"
if [[ -n "$email_env" ]]; then
  cp "$email_env" "$target_email_env"
  printf 'email-agent env copied from %s.\n' "$email_env"
elif [[ -f "$target_email_env" ]]; then
  printf 'email-agent env already exists; kept as-is.\n'
else
  echo "email-agent env source was not found." >&2
  exit 1
fi
