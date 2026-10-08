#!/usr/bin/env bash
#
# verify-workspace.sh — prove a FlareSolverr workspace works, then prove it left nothing behind.
#
# Exercises the whole path in the order a failure would appear, so the first
# failing check names the broken layer: Docker reachable -> image pullable ->
# container starts -> /health answers -> loopback-only -> request.get solves ->
# teardown removes everything.
#
# Usage:
#   scripts/verify-workspace.sh [--url URL] [--image IMAGE] [--timeout SECONDS] [--keep]
#
# Options:
#   --url URL        URL to fetch in the request.get check.
#                    Default: https://example.com/ (unprotected, so a failure
#                    points at the container rather than at a challenge).
#   --image IMAGE    Container image. Default: ghcr.io/flaresolverr/flaresolverr:latest
#   --timeout SECS   Readiness budget in seconds. Default: 90
#   --keep           Leave the container running for inspection on failure.
#   -h, --help       Show this help.
#
# Exits non-zero on the first failed check. Requires the docker CLI and a
# reachable daemon; the image is pulled if it is not already present.

set -euo pipefail

url="https://example.com/"
image="ghcr.io/flaresolverr/flaresolverr:latest"
timeout_secs=90
keep=0

usage() { sed -n '3,/^$/p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

while [ $# -gt 0 ]; do
  case "$1" in
    --url)     [ $# -ge 2 ] || { echo "--url needs a value" >&2; exit 2; }; url="$2"; shift 2 ;;
    --image)   [ $# -ge 2 ] || { echo "--image needs a value" >&2; exit 2; }; image="$2"; shift 2 ;;
    --timeout) [ $# -ge 2 ] || { echo "--timeout needs a value" >&2; exit 2; }; timeout_secs="$2"; shift 2 ;;
    --keep)    keep=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [ -t 1 ]; then
  RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; OFF=$'\033[0m'
else
  RED=""; GREEN=""; YELLOW=""; OFF=""
fi

ok()   { printf '%s✓%s %s\n' "$GREEN" "$OFF" "$1"; }
warn() { printf '%s!%s %s\n' "$YELLOW" "$OFF" "$1"; }
fail() { printf '%s✗%s %s\n' "$RED" "$OFF" "$1" >&2; exit 1; }
step() { printf '\n%s\n' "$1"; }

# Unique per run so a leftover container can never be mistaken for this one.
suffix="verify-$$"
name="flaresolverr-$suffix"
network="$name-net"

cleanup() {
  local status=$?
  if [ "$keep" -eq 1 ] && [ "$status" -ne 0 ]; then
    warn "--keep: leaving $name running for inspection"
    warn "  docker logs $name"
    warn "  docker rm -f $name && docker network rm $network"
    return
  fi
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT

leaked_containers() {
  docker ps -a --filter label=dsh.plugin=flaresolverr --format '{{.Names}}' 2>/dev/null | sed '/^$/d'
}
leaked_networks() {
  docker network ls --filter label=dsh.plugin=flaresolverr --format '{{.Name}}' 2>/dev/null | sed '/^$/d'
}

# ---------------------------------------------------------------------------
printf 'FlareSolverr workspace verification\n'
printf '  image:   %s\n' "$image"
printf '  url:     %s\n' "$url"
printf '  timeout: %ss\n' "$timeout_secs"

# ---------------------------------------------------------------------------
step '1. Docker is reachable'

command -v docker >/dev/null 2>&1 \
  || fail "the docker CLI is not on PATH — install Docker Engine and retry"
docker info >/dev/null 2>&1 \
  || fail "the Docker daemon is not reachable — start it (\`sudo systemctl start docker\`) and retry"
ok "docker $(docker version --format '{{.Server.Version}}' 2>/dev/null || echo '?') responding"

# ---------------------------------------------------------------------------
step '2. Image is available'

if docker image inspect "$image" >/dev/null 2>&1; then
  ok "image already present locally"
else
  printf '  pulling %s (this can take a while on a cold host)…\n' "$image"
  docker pull "$image" >/dev/null 2>&1 \
    || fail "could not pull $image — check network access to the registry, or pre-pull it and pass --image"
  ok "image pulled"
fi

# ---------------------------------------------------------------------------
step '3. Container starts and answers /health'

docker network create --label dsh.plugin=flaresolverr --label dsh.verify=1 "$network" >/dev/null \
  || fail "could not create a Docker network"

# Mirrors the plugin exactly: loopback-only ephemeral port, raised /dev/shm,
# no privilege escalation, and a disposable restart policy.
container_id=$(docker run -d \
  --name "$name" \
  --label dsh.plugin=flaresolverr \
  --label dsh.workspace="$name" \
  --label dsh.network="$network" \
  --network "$network" \
  -p 127.0.0.1::8191 \
  --shm-size 2g \
  --security-opt no-new-privileges \
  --memory 1g \
  --cpus 2 \
  --restart no \
  -e LOG_LEVEL=info \
  "$image") || fail "the container failed to start"

ok "container started (${container_id:0:12})"

deadline=$(( $(date +%s) + timeout_secs ))
host_port=""
while :; do
  if ! docker inspect -f '{{.State.Running}}' "$name" 2>/dev/null | grep -q true; then
    printf '\n'
    docker logs --tail 40 "$name" 2>&1 | sed 's/^/    /' >&2
    fail "the container exited during startup — the log above is the cause"
  fi

  host_port=$(docker port "$name" 8191/tcp 2>/dev/null | head -n1 | sed 's/.*://')
  if [ -n "$host_port" ] && curl -fsS --max-time 3 "http://127.0.0.1:$host_port/health" >/dev/null 2>&1; then
    break
  fi

  if [ "$(date +%s)" -ge "$deadline" ]; then
    printf '\n'
    docker logs --tail 40 "$name" 2>&1 | sed 's/^/    /' >&2
    fail "/health did not answer within ${timeout_secs}s — raise --timeout on a slow host, and check the log above"
  fi
  printf '.'
  sleep 1
done
printf '\n'
ok "/health answering on 127.0.0.1:$host_port"

health=$(curl -fsS "http://127.0.0.1:$host_port/health")
case "$health" in
  *'"status"'*ok*) ok "health payload reports ok" ;;
  *) fail "unexpected /health payload: $health" ;;
esac

# ---------------------------------------------------------------------------
step '4. The endpoint is loopback-only'

binding=$(docker port "$name" 8191/tcp | head -n1)
case "$binding" in
  127.0.0.1:*) ok "published on $binding — not reachable from the network" ;;
  *) fail "published on $binding, which is NOT loopback-only — FlareSolverr has no authentication and must never be exposed" ;;
esac

# ---------------------------------------------------------------------------
step '5. request.get actually works'

body=$(curl -fsS --max-time 120 -X POST "http://127.0.0.1:$host_port/v1" \
  -H 'Content-Type: application/json' \
  -d "{\"cmd\":\"request.get\",\"url\":\"$url\",\"maxTimeout\":90000,\"disableMedia\":true}" 2>/dev/null) \
  || fail "the POST /v1 call failed at the transport level"

case "$body" in
  *'"status":"ok"'*|*'"status": "ok"'*) ok "the API answered status ok" ;;
  *) fail "the API did not answer ok. Response: ${body:0:400}" ;;
esac

case "$body" in
  *'"userAgent"'*) ok "the solution carries a userAgent (required to reuse the cookies downstream)" ;;
  *) warn "no userAgent in the solution — cookie reuse downstream may fail" ;;
esac

case "$body" in
  *'Challenge solved!'*) ok "a Cloudflare/DDoS-Guard challenge was solved" ;;
  *'Challenge not detected!'*)
    ok "the request completed; the target presented no challenge"
    if [ "$url" = "https://example.com/" ]; then
      ok "  (expected: the default target is deliberately unprotected, so a failure here would point at the container rather than the target)"
    else
      warn "no challenge was detected on $url — either it is unprotected, or the challenge markup was not recognised"
    fi
    ;;
  *) warn "unexpected solution message; inspect the response if this was meant to be a protected page" ;;
esac

# ---------------------------------------------------------------------------
step '6. Teardown removes everything'

docker stop --time 10 "$name" >/dev/null 2>&1 || true
docker rm --force "$name" >/dev/null 2>&1 || true
docker network rm "$network" >/dev/null 2>&1 || true
trap - EXIT

if docker ps -a --format '{{.Names}}' | grep -qx "$name"; then
  fail "container $name survived teardown"
fi
ok "container and network removed"

# ---------------------------------------------------------------------------
step '7. Nothing was left behind'

containers=$(leaked_containers)
if [ -n "$containers" ]; then
  printf '%s\n' "$containers" | sed 's/^/    /' >&2
  fail "containers labelled dsh.plugin=flaresolverr are still present (listed above)"
fi
ok "no leftover containers"

networks=$(leaked_networks)
if [ -n "$networks" ]; then
  printf '%s\n' "$networks" | sed 's/^/    /' >&2
  fail "networks labelled dsh.plugin=flaresolverr are still present (listed above)"
fi
ok "no leftover networks"

printf '\n%sAll checks passed.%s The workspace path is healthy end to end.\n' "$GREEN" "$OFF"
