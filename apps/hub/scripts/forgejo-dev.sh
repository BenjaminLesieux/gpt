#!/usr/bin/env bash
#
# Brings up the development Forgejo and leaves apps/hub/.env holding a working
# site-admin token. Safe to re-run: if the token already in .env still
# authenticates, nothing is created and nothing is rewritten.
#
# Bootstrapping the *first* admin token is the one thing the admin API cannot
# do for itself, so it happens here through the container's own CLI. That is
# not the container-exec provisioning decision 2 rejects — the hub still
# creates every user, repo and token over HTTP, and never shells into
# anything.

set -euo pipefail

HUB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$HUB_DIR/docker-compose.dev.yml"
ENV_FILE="$HUB_DIR/.env"
EXAMPLE_FILE="$HUB_DIR/.env.example"

FORGEJO_URL="http://localhost:3001"
ADMIN_USER="gitarpro-admin"
ADMIN_EMAIL="admin@gitarpro.localhost"

compose() { docker compose -f "$COMPOSE_FILE" "$@"; }
in_forgejo() { compose exec -T -u git forgejo forgejo "$@"; }

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

# --- the instance -----------------------------------------------------------

say "Starting Forgejo"
compose up -d

printf 'Waiting for %s/api/healthz ' "$FORGEJO_URL"
for _ in $(seq 1 60); do
  if curl -sf "$FORGEJO_URL/api/healthz" >/dev/null 2>&1; then
    printf ' up\n'
    break
  fi
  printf '.'
  sleep 2
done

if ! curl -sf "$FORGEJO_URL/api/healthz" >/dev/null 2>&1; then
  printf '\n'
  echo "Forgejo did not come up. Try: docker compose -f $COMPOSE_FILE logs forgejo" >&2
  exit 1
fi

# --- is it already set up? --------------------------------------------------

existing_token=""
if [ -f "$ENV_FILE" ]; then
  existing_token="$(sed -n 's/^FORGEJO_ADMIN_TOKEN=//p' "$ENV_FILE" | tail -n 1)"
fi

if [ -n "$existing_token" ] && curl -sf \
  -H "Authorization: token $existing_token" \
  "$FORGEJO_URL/api/v1/admin/users" >/dev/null 2>&1; then
  say "Already set up"
  echo "The token in .env still authenticates against $FORGEJO_URL."
  echo "Forgejo UI: $FORGEJO_URL  (user $ADMIN_USER)"
  exit 0
fi

# --- the site admin ---------------------------------------------------------

if in_forgejo admin user list 2>/dev/null | awk 'NR>1 {print $2}' | grep -qx "$ADMIN_USER"; then
  say "Site admin $ADMIN_USER already exists"
else
  say "Creating site admin $ADMIN_USER"
  # Forgejo enforces length and complexity on this, and (where enabled) checks
  # it against HIBP, so it is generated rather than chosen.
  # `tr </dev/urandom | head` would look simpler and would break the script:
  # head exits first, tr takes SIGPIPE, and pipefail turns that into a failure
  # with nothing printed. Keep the finite reader upstream.
  admin_random="$(head -c 48 /dev/urandom | base64 | LC_ALL=C tr -dc 'A-Za-z0-9')"
  admin_password="${admin_random:0:32}Aa1!"
  in_forgejo admin user create \
    --username "$ADMIN_USER" \
    --email "$ADMIN_EMAIL" \
    --password "$admin_password" \
    --admin \
    --must-change-password=false
  printf '\n  Web password for %s: %s\n' "$ADMIN_USER" "$admin_password"
  printf '  Nothing stores this — the hub does not need it. Write it down if\n'
  printf '  you want the web UI, or make a new one with:\n'
  printf '    docker compose -f %s exec -u git forgejo forgejo admin user change-password --username %s --password ...\n' \
    "$COMPOSE_FILE" "$ADMIN_USER"
fi

# --- the admin token --------------------------------------------------------

# Token names are unique per user and there is no CLI to delete one, so a
# re-run after a revoked token would collide on a fixed name.
token_name="hub-dev-$(date +%s)"

say "Minting a write:admin token ($token_name)"
token="$(in_forgejo admin user generate-access-token \
  --username "$ADMIN_USER" \
  --token-name "$token_name" \
  --scopes write:admin \
  --raw | tr -d '\r\n')"

if [ -z "$token" ]; then
  echo "Forgejo returned no token." >&2
  exit 1
fi

# --- .env -------------------------------------------------------------------

if [ ! -f "$ENV_FILE" ]; then
  cp "$EXAMPLE_FILE" "$ENV_FILE"
fi

tmp="$(mktemp)"
sed -e "s|^FORGEJO_ADMIN_TOKEN=.*|FORGEJO_ADMIN_TOKEN=$token|" \
    -e "s|^FORGEJO_URL=.*|FORGEJO_URL=$FORGEJO_URL|" "$ENV_FILE" > "$tmp"
mv "$tmp" "$ENV_FILE"
chmod 600 "$ENV_FILE"

say "Ready"
echo "  Forgejo   $FORGEJO_URL   (admin $ADMIN_USER)"
echo "  Swagger   $FORGEJO_URL/api/swagger"
echo "  Spec      $FORGEJO_URL/swagger.v1.json"
echo "  Token     written to apps/hub/.env, not printed here"
echo
echo "  Next: pnpm nx serve @gpt/hub"
