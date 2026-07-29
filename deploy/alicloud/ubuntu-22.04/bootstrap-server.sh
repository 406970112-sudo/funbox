#!/usr/bin/env bash

set -euo pipefail

GO_VERSION="${GO_VERSION:-1.26.2}"
NODE_MAJOR="${NODE_MAJOR:-20}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Please run this script with sudo or as root."
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y \
  ca-certificates \
  curl \
  git \
  unzip \
  rsync \
  build-essential \
  nginx \
  certbot \
  python3-certbot-nginx

if ! command -v node >/dev/null 2>&1; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi

if ! command -v go >/dev/null 2>&1; then
  if curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz" -o /tmp/go.tar.gz; then
    rm -rf /usr/local/go
    tar -C /usr/local -xzf /tmp/go.tar.gz

    cat >/etc/profile.d/go.sh <<'EOF'
export PATH="/usr/local/go/bin:$PATH"
EOF

    export PATH="/usr/local/go/bin:$PATH"
  else
    apt-get install -y golang-go
  fi
fi

systemctl enable nginx
systemctl start nginx
systemctl enable --now certbot.timer

echo "Bootstrap completed."
echo "Node version: $(node -v)"
echo "NPM version: $(npm -v)"
echo "Go version: $(/usr/local/go/bin/go version 2>/dev/null || go version)"
