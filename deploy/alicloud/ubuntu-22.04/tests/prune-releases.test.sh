#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PRUNE_SCRIPT="$SCRIPT_DIR/../prune-releases.sh"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

make_release() {
  local releases_root="$1"
  local release_sha="$2"

  mkdir -p "$releases_root/$release_sha"
  printf '%s\n' "$release_sha" >"$releases_root/$release_sha/marker"
}

test_prunes_stale_release_directories() {
  local workspace
  local releases_root
  local current_link
  local current_sha="1111111111111111111111111111111111111111"
  local stale_sha="2222222222222222222222222222222222222222"
  local failed_sha="3333333333333333333333333333333333333333"

  workspace="$(mktemp -d)"
  releases_root="$workspace/my-first-expo-app-releases"
  mkdir -p "$releases_root/manual-backup"
  make_release "$releases_root" "$current_sha"
  make_release "$releases_root" "$stale_sha"
  make_release "$releases_root" "$failed_sha"
  current_link="$releases_root/$current_sha"

  RELEASES_ROOT="$releases_root" CURRENT_LINK="$current_link" bash "$PRUNE_SCRIPT"

  [[ -f "$releases_root/$current_sha/marker" ]] || fail "current release was removed"
  [[ ! -e "$releases_root/$stale_sha" ]] || fail "stale release was not removed"
  [[ ! -e "$releases_root/$failed_sha" ]] || fail "failed release residue was not removed"
  [[ -d "$releases_root/manual-backup" ]] || fail "non-release directory was removed"

  rm -rf "$workspace"
}

test_rejects_unsafe_release_root() {
  local workspace
  local output

  workspace="$(mktemp -d)"
  output="$workspace/output"
  mkdir -p "$workspace/not-a-release-root"

  if RELEASES_ROOT="$workspace/not-a-release-root" \
    CURRENT_LINK="$workspace/current" \
    bash "$PRUNE_SCRIPT" >"$output" 2>&1; then
    fail "unsafe release root was accepted"
  fi

  grep -Fq "Refusing to prune unsafe releases root" "$output" ||
    fail "unsafe release root did not report the expected error"

  rm -rf "$workspace"
}

test_prunes_stale_release_directories
test_rejects_unsafe_release_root
printf 'PASS: prune-releases tests\n'
