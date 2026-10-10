#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ARCHIVE_SCRIPT="$SCRIPT_DIR/../create-source-archive.sh"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

[[ -f "$ARCHIVE_SCRIPT" ]] || fail "deployment source archive script is missing"

workspace="$(mktemp -d)"
trap 'rm -rf "$workspace"' EXIT
source_root="$workspace/source"
mkdir -p "$source_root"
cd "$source_root"
git init -q
git config core.autocrlf false

for path in package.json package-lock.json .gitattributes \
  frontend/app/index.tsx frontend/assets/icon.png \
  backend/cmd/api/main.go backend/go.mod \
  email-agent/backend/src/index.ts email-agent/frontend/src/main.tsx \
  deploy/alicloud/ubuntu-22.04/update-server.sh docs/design.png \
  scripts/design.mjs miniprogram/app.js email-agent-backend/index.ts; do
  mkdir -p "$(dirname "$path")"
  printf 'tracked %s\n' "$path" >"$path"
done
git add .
git -c user.name=ArchiveTest -c user.email=archive-test@example.com commit -qm fixture

mkdir -p frontend/node_modules backend/data
printf 'secret\n' >frontend/.env
printf 'dependency\n' >frontend/node_modules/dependency.js
printf 'database\n' >backend/data/app.db

bash "$ARCHIVE_SCRIPT" "$workspace/source.tar.gz"
mkdir "$workspace/extracted"
tar -xzf "$workspace/source.tar.gz" -C "$workspace/extracted"

for path in package.json package-lock.json .gitattributes \
  frontend/app/index.tsx frontend/assets/icon.png \
  backend/cmd/api/main.go backend/go.mod \
  email-agent/backend/src/index.ts email-agent/frontend/src/main.tsx \
  deploy/alicloud/ubuntu-22.04/update-server.sh; do
  cmp "$source_root/$path" "$workspace/extracted/$path" || fail "required source missing or changed: $path"
done

for path in docs scripts miniprogram email-agent-backend \
  frontend/.env frontend/node_modules backend/data .git; do
  [[ ! -e "$workspace/extracted/$path" ]] || fail "non-deployment content included: $path"
done

printf 'PASS: deployment archive contains required sources only\n'
