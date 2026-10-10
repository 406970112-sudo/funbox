#!/usr/bin/env bash

set -Eeuo pipefail

service="${1:?Service name is required}"
url="${2:?Health URL is required}"
attempts="${3:-30}"
delay_seconds="${4:-2}"

# Type=simple services can be active before their HTTP listener is ready.
for ((attempt = 1; attempt <= attempts; attempt++)); do
  if curl --fail --silent --show-error --connect-timeout 2 --max-time 5 "$url"; then
    printf '\n%s is ready.\n' "$service"
    exit 0
  fi
  if ((attempt < attempts)); then
    printf 'Waiting for %s at %s (%s/%s).\n' "$service" "$url" "$attempt" "$attempts"
    sleep "$delay_seconds"
  fi
done

printf '%s did not become ready at %s after %s probes.\n' "$service" "$url" "$attempts"
systemctl status --no-pager "$service" || true
journalctl -u "$service" -n 80 --no-pager || true
exit 1
