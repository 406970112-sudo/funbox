#!/usr/bin/env bash

set -Eeuo pipefail

archive_path="${1:?Usage: create-source-archive.sh OUTPUT.tar.gz}"
source_ref="${SOURCE_REF:-HEAD}"

# Archive tracked runtime sources only; design documents dominate the full archive.
git archive --format=tar "$source_ref" \
  .gitattributes package.json package-lock.json \
  frontend backend email-agent deploy |
  gzip -9 >"$archive_path"

printf 'Deployment source archive: %s bytes\n' "$(wc -c <"$archive_path")"
