#!/usr/bin/env bash
# Smoke-tests a compiled cp750 executable: `serve --mock` answers health, the web client and a
# param read, and enforces the request rules (Host, Origin, JSON-only mutations, HEAD on the event
# stream). It runs in a scratch directory holding a .env file, which the executable must ignore.
#
#   scripts/smoke-test.sh dist/cp750-linux-x64 [port]
set -euo pipefail

bin=$(realpath "${1:?usage: smoke-test.sh <cp750 executable> [port]}")
port=${2:-22750}
base="http://127.0.0.1:${port}"
work=$(mktemp -d)
log="$work/serve.log"
pid=""

cleanup() {
  if [[ -n "$pid" ]]; then kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; fi
  rm -rf "$work"
}
trap cleanup EXIT

fail() {
  echo "FAIL: $*" >&2
  echo "--- server log ---" >&2
  cat "$log" >&2 || true
  exit 1
}

# Would make the server read-only and change its port if .env were loaded.
printf 'CP750_READ_ONLY=1\nCP750_LISTEN_PORT=1\n' >"$work/.env"
cp "$work/.env" "$work/.env.local"

(cd "$work" && CP750_LISTEN_PORT="$port" exec "$bin" serve --mock) >"$log" 2>&1 &
pid=$!

for _ in $(seq 1 100); do
  curl -fsS "$base/api/health" >/dev/null 2>&1 && break
  kill -0 "$pid" 2>/dev/null || fail "the server exited"
  sleep 0.1
done

status() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
expect() {
  local want=$1 what=$2
  shift 2
  local got
  got=$(status "$@")
  [[ "$got" == "$want" ]] || fail "$what: expected $want, got $got"
  echo "ok   $what ($got)"
}

expect 200 "GET /api/health" "$base/api/health"
curl -fsS "$base/" | grep -qi '<!doctype html' || fail "GET / did not serve the web client"
echo "ok   GET / serves the web client"

# The mock connects in the background; wait for it, then read a param.
for _ in $(seq 1 100); do
  curl -fsS "$base/api/device" | grep -q '"connection":"connected"' && break
  sleep 0.1
done
reading=$(curl -fsS "$base/api/params/cp750.sys.fader") || fail "GET /api/params/cp750.sys.fader"
echo "$reading" | grep -q '"name":"cp750.sys.fader"' || fail "unexpected reading: $reading"
echo "ok   GET /api/params/cp750.sys.fader -> $reading"

curl -fsS "$base/api/device" | grep -q '"readOnly":false' || fail ".env was loaded (read-only)"
echo "ok   .env and .env.local are not loaded"

expect 421 "a foreign Host is refused" -H "Host: rebind.example:${port}" "$base/api/device"
expect 421 "the event stream refuses a foreign Host" -H "Host: rebind.example" "$base/api/events"
expect 403 "a cross-origin write is refused" -X PUT -H 'Content-Type: application/json' \
  -H 'Origin: https://evil.example' -d '{"value":70}' "$base/api/params/cp750.sys.fader"
expect 415 "a body-less action without JSON is refused" -X POST \
  "$base/api/actions/cp750.ctrl.fader_delta"
expect 415 "a form-encoded write is refused" -X PUT \
  -H 'Content-Type: application/x-www-form-urlencoded' -d 'value=70' \
  "$base/api/params/cp750.sys.fader"
expect 405 "a wrong method is 405" -X DELETE "$base/api/params/cp750.sys.fader"
expect 200 "a JSON write works" -X PUT -H 'Content-Type: application/json' -d '{"value":70}' \
  "$base/api/params/cp750.sys.fader"

for _ in $(seq 1 50); do
  curl -sS -m 2 -I "$base/api/events" >/dev/null || fail "HEAD /api/events did not answer"
done
echo "ok   HEAD /api/events answers at once (50 times)"
# With leaked subscriptions the cap (32) would now be exhausted.
code=$(curl -s -o /dev/null -m 1 -w '%{http_code}' "$base/api/events" || true)
[[ "$code" == "200" ]] || fail "GET /api/events after the HEADs: $code"
echo "ok   GET /api/events still opens a stream"

echo "smoke test passed"
