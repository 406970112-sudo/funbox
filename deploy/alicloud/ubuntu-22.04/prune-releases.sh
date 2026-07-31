#!/usr/bin/env bash

set -Eeuo pipefail

RELEASES_ROOT="${RELEASES_ROOT:-/srv/my-first-expo-app-releases}"
CURRENT_LINK="${CURRENT_LINK:-/srv/my-first-expo-app-current}"

resolved_releases_root="$(realpath -m "$RELEASES_ROOT")"
if [[ "$(basename "$resolved_releases_root")" != "my-first-expo-app-releases" ]]; then
  echo "Refusing to prune unsafe releases root: $resolved_releases_root"
  exit 1
fi

mkdir -p "$resolved_releases_root"

current_release=""
if [[ -e "$CURRENT_LINK" || -L "$CURRENT_LINK" ]]; then
  current_release="$(realpath -e "$CURRENT_LINK" 2>/dev/null || true)"
  if [[ -z "$current_release" ]] ||
    [[ "$(dirname "$current_release")" != "$resolved_releases_root" ]] ||
    [[ ! "$(basename "$current_release")" =~ ^[0-9a-f]{40}$ ]]; then
    echo "Refusing to prune because current release is outside $resolved_releases_root: $CURRENT_LINK"
    exit 1
  fi
fi

shopt -s nullglob
for release_dir in "$resolved_releases_root"/*; do
  [[ -d "$release_dir" ]] || continue
  [[ "$(basename "$release_dir")" =~ ^[0-9a-f]{40}$ ]] || continue

  resolved_release="$(realpath -e "$release_dir")"
  if [[ "$resolved_release" == "$current_release" ]]; then
    printf 'Keeping current release: %s\n' "$resolved_release"
    continue
  fi

  rm -rf -- "$release_dir"
  printf 'Removed stale release: %s\n' "$resolved_release"
done
shopt -u nullglob

df -h "$resolved_releases_root"
