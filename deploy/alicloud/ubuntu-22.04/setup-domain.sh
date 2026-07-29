#!/usr/bin/env bash

set -Eeuo pipefail

APP_NAME="${APP_NAME:-my-first-expo-app}"
APP_USER="${APP_USER:-www-data}"
APP_GROUP="${APP_GROUP:-www-data}"
APP_ROOT="${APP_ROOT:-/srv/my-first-expo-app}"
PUBLIC_IP="${PUBLIC_IP:-39.107.136.182}"
BACKEND_PORT="${BACKEND_PORT:-3000}"
EMAIL_AGENT_PORT="${EMAIL_AGENT_PORT:-1234}"
PRIMARY_DOMAIN="${1:-${APP_DOMAIN:-}}"
WWW_DOMAIN="${2:-}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Please run this script with sudo or as root."
  exit 1
fi

if [[ -z "$PRIMARY_DOMAIN" ]]; then
  echo "Usage: sudo bash setup-domain.sh example.com [www.example.com]"
  exit 1
fi

WEB_ROOT="/var/www/$APP_NAME/frontend"
NGINX_CONF="/etc/nginx/sites-available/$PRIMARY_DOMAIN.conf"
SERVER_NAMES="$PRIMARY_DOMAIN"
if [[ -n "$WWW_DOMAIN" ]]; then
  SERVER_NAMES="$SERVER_NAMES $WWW_DOMAIN"
fi

echo "Configuring Nginx for: $SERVER_NAMES"
mkdir -p "$WEB_ROOT"
chown -R "$APP_USER:$APP_GROUP" "$WEB_ROOT"

cat >"$NGINX_CONF" <<EOF
server {
  listen 80;
  server_name $SERVER_NAMES;

  root $WEB_ROOT;
  index index.html;

  add_header Permissions-Policy "camera=(self), microphone=(self)" always;

  location = /email-agent {
    return 301 /email-agent/;
  }

  location /email-agent/ {
    try_files \$uri \$uri/ /email-agent/index.html;
  }

  location = /api/agent {
    proxy_pass http://127.0.0.1:$EMAIL_AGENT_PORT/api/agent;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;
    proxy_buffering off;
    proxy_cache off;
  }

  location = /api/recipients {
    proxy_pass http://127.0.0.1:$EMAIL_AGENT_PORT/api/recipients;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }

  location /api/ {
    proxy_pass http://127.0.0.1:$BACKEND_PORT/api/;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;
  }

  location /voice/ {
    proxy_pass http://127.0.0.1:$BACKEND_PORT/voice/;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }

  location = /healthz {
    proxy_pass http://127.0.0.1:$BACKEND_PORT/healthz;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }

  location / {
    try_files \$uri \$uri/ /index.html;
  }
}
EOF

ln -sf "$NGINX_CONF" "/etc/nginx/sites-enabled/$PRIMARY_DOMAIN.conf"
nginx -t
systemctl reload nginx

resolved_ip="$(getent ahostsv4 "$PRIMARY_DOMAIN" | awk '{ print $1; exit }' || true)"
if [[ "$resolved_ip" != "$PUBLIC_IP" ]]; then
  echo "DNS is not ready for $PRIMARY_DOMAIN yet."
  echo "Expected: $PUBLIC_IP"
  echo "Actual: ${resolved_ip:-not found}"
  echo "Nginx HTTP config is ready. Re-run this command after DNS resolves to $PUBLIC_IP:"
  echo "sudo bash $APP_ROOT/deploy/alicloud/ubuntu-22.04/setup-domain.sh $PRIMARY_DOMAIN${WWW_DOMAIN:+ $WWW_DOMAIN}"
  exit 0
fi

certbot_domains=(-d "$PRIMARY_DOMAIN")
if [[ -n "$WWW_DOMAIN" ]]; then
  certbot_domains+=(-d "$WWW_DOMAIN")
fi

echo "Requesting HTTPS certificate for: $SERVER_NAMES"
certbot --nginx --redirect --non-interactive --agree-tos \
  --email "${CERTBOT_EMAIL:-18284838648@163.com}" \
  "${certbot_domains[@]}"

nginx -t
systemctl reload nginx

echo "Domain setup completed:"
echo "https://$PRIMARY_DOMAIN"
if [[ -n "$WWW_DOMAIN" ]]; then
  echo "https://$WWW_DOMAIN"
fi
