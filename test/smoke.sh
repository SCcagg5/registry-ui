#!/bin/sh
set -eu

configured_port="${REGISTRY_UI_PORT:-}"
if [ -z "$configured_port" ] && [ -f .env ]; then
  configured_port="$(sed -n 's/^REGISTRY_UI_PORT=//p' .env | head -n 1)"
fi
configured_port="${configured_port:-8080}"
BASE_URL="${1:-http://127.0.0.1:${configured_port}}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT INT TERM

request() {
  expected="$1"
  output="$2"
  shift 2
  status="$(curl -sS -o "$output" -w '%{http_code}' "$@")"
  if [ "$status" != "$expected" ]; then
    echo "Received HTTP $status; expected HTTP $expected for: curl $*" >&2
    cat "$output" >&2 || true
    exit 1
  fi
}

attempt=0
until curl -fsS "$BASE_URL/healthz" >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 60 ]; then
    echo "Registry UI did not become ready at $BASE_URL" >&2
    exit 1
  fi
  sleep 1
done

request 200 "$TMP_DIR/health.json" "$BASE_URL/healthz"
grep -q '"status":"ok"' "$TMP_DIR/health.json"

request 200 "$TMP_DIR/config.json" "$BASE_URL/config.json"
grep -q '"name":"registry-ui"' "$TMP_DIR/config.json"
grep -q '"deleteEnabled":true' "$TMP_DIR/config.json"

request 200 "$TMP_DIR/catalog.json" "$BASE_URL/api/catalog?n=25"
grep -q '"name":"circular/registry-ui"' "$TMP_DIR/catalog.json"
grep -q '"name":"infrastructure/nginx"' "$TMP_DIR/catalog.json"

request 200 "$TMP_DIR/tags.json" \
  "$BASE_URL/api/tags?repo=circular%2Fregistry-ui&n=25"
grep -q '"name":"v1.4.2"' "$TMP_DIR/tags.json"
grep -q '"name":"latest"' "$TMP_DIR/tags.json"

request 200 "$TMP_DIR/detail.json" \
  "$BASE_URL/api/tag?repo=circular%2Fregistry-ui&tag=v1.4.2"
grep -q '"linux/amd64"' "$TMP_DIR/detail.json"
grep -q '"linux/arm64"' "$TMP_DIR/detail.json"
grep -q '"entrypoint"' "$TMP_DIR/detail.json"
grep -q '"args":\["VERSION=v1.4.2"\]' "$TMP_DIR/detail.json"
grep -q '"configSize":' "$TMP_DIR/detail.json"
grep -q '"layerSize":' "$TMP_DIR/detail.json"
grep -q '"manifestSize":' "$TMP_DIR/detail.json"
grep -q '"indexSize":' "$TMP_DIR/detail.json"
grep -q '"instruction":"FROM scratch"' "$TMP_DIR/detail.json"
grep -q '"instruction":"EXPOSE 8080"' "$TMP_DIR/detail.json"
grep -q '"instruction":"HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD \[\\"/registry-ui\\", \\"health\\", \\"--quiet\\"\]"' "$TMP_DIR/detail.json"
grep -q '"singleTag":false' "$TMP_DIR/detail.json"

request 200 "$TMP_DIR/nginx-detail.json" \
  "$BASE_URL/api/tag?repo=infrastructure%2Fnginx&tag=1.29-alpine"
grep -q '"singleTag":true' "$TMP_DIR/nginx-detail.json"
grep -q '"configSize":' "$TMP_DIR/nginx-detail.json"
grep -q '"layerSize":' "$TMP_DIR/nginx-detail.json"

request 200 "$TMP_DIR/image.oci.tar" \
  "$BASE_URL/api/download?repo=circular%2Fregistry-ui&tag=v1.4.2"
tar -tf "$TMP_DIR/image.oci.tar" >"$TMP_DIR/archive.txt"
grep -qx 'oci-layout' "$TMP_DIR/archive.txt"
grep -qx 'index.json' "$TMP_DIR/archive.txt"
grep -q '^blobs/sha256/' "$TMP_DIR/archive.txt"

image_digest="$(grep -o '"digest":"sha256:[0-9a-f]\{64\}"' "$TMP_DIR/detail.json" | head -n 1 | cut -d '"' -f 4)"
test -n "$image_digest"
request 200 "$TMP_DIR/image.docker.tar" \
  "$BASE_URL/api/download/docker?repo=circular%2Fregistry-ui&tag=v1.4.2&digest=$image_digest"
tar -tf "$TMP_DIR/image.docker.tar" >"$TMP_DIR/docker-archive.txt"
grep -qx 'manifest.json' "$TMP_DIR/docker-archive.txt"
grep -q '\.json$' "$TMP_DIR/docker-archive.txt"
grep -q '\.tar$' "$TMP_DIR/docker-archive.txt"

if [ "${VERIFY_DOCKER_LOAD:-0}" = "1" ]; then
  docker image load --input "$TMP_DIR/image.docker.tar"
  docker image inspect circular/registry-ui:v1.4.2 >/dev/null
  docker image rm circular/registry-ui:v1.4.2 >/dev/null
fi

request 200 "$TMP_DIR/registry-version" "$BASE_URL/v2/"

echo "Registry UI integration smoke test passed"
