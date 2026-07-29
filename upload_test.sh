#!/usr/bin/env bash
set -Eeuo pipefail

REGISTRY_HOST="127.0.0.1:5000"
NAMESPACE="infrastructure"
VERSION="1.0.0"
BUILDER="registry-local-builder"

docker compose -f test/docker-compose.yaml up -d registry

curl --fail --silent --show-error \
  "http://${REGISTRY_HOST}/v2/" >/dev/null

if ! docker buildx inspect "$BUILDER" >/dev/null 2>&1; then
  docker buildx create \
    --name "$BUILDER" \
    --driver docker-container \
    --driver-opt network=host
fi

docker buildx use "$BUILDER"
docker buildx inspect --bootstrap

# Registry UI
docker buildx build \
  --builder "$BUILDER" \
  --platform linux/amd64,linux/arm64 \
  --file test/browser/Dockerfile \
  --target runtime \
  --build-arg VERSION="$VERSION" \
  --tag "$REGISTRY_HOST/$NAMESPACE/registry-ui:$VERSION" \
  --push \
  .

# Docker Registry
docker buildx build \
  --builder "$BUILDER" \
  --platform linux/amd64,linux/arm64 \
  --tag "$REGISTRY_HOST/$NAMESPACE/registry:3.0.0" \
  --push \
  - <<'DOCKERFILE'
FROM docker.io/library/registry:3.0.0
DOCKERFILE

echo "Images pushed:"
echo "  $REGISTRY_HOST/$NAMESPACE/registry-ui:$VERSION"
echo "  $REGISTRY_HOST/$NAMESPACE/registry:3.0.0"