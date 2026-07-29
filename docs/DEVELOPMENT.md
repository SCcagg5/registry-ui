# Development and validation

## Requirements

- Go 1.23 or newer;
- Node.js 22 or newer for frontend contracts;
- Docker with Compose for the integration stack;
- `curl` and `tar` for the integration smoke test.

## Build

```sh
cd src
CGO_ENABLED=0 go build -tags=netgo,osusergo -trimpath -o registry-ui .
```

Run against a registry:

```sh
REGISTRY_URL=http://127.0.0.1:5000 ./registry-ui
```

## Go validation

```sh
cd src
test -z "$(gofmt -l *.go)"
go test -count=1 ./...
go test -race -count=1 ./...
go vet ./...
CGO_ENABLED=0 go build -tags=netgo,osusergo -trimpath -o /tmp/registry-ui-check .
```

Validate the deterministic OCI fixture publisher:

```sh
cd test/seed
test -z "$(gofmt -l *.go)"
go test -count=1 ./...
go vet ./...
```

## Frontend validation

From the repository root:

```sh
node --check src/public/assets/js/api.js
node --check src/public/assets/js/app.js
node --check test/frontend-contract.mjs
node --check test/tag-detail-format.mjs
node test/frontend-contract.mjs
node test/tag-detail-format.mjs
```

The frontend contract verifies:

- Registry UI's original navigation and page structure;
- S3 Browser design tokens and component styling without its navigation layout;
- local Material Design icon mappings;
- relative API URL resolution;
- repository/tag list header search, borderless contextual view header, and removal of the legacy toolbar panel;
- full digests, platform metadata, type-aware runtime/label values, colorized config views, exposed ports, and the one-third/two-thirds layout contract;
- merged Dockerfile/history ordering, line continuations, sticky non-copyable line numbers, copy isolation, syntax colors, and aligned cumulative/change/date metadata;
- distinct OCI and Docker load archive actions;
- absence of external frontend assets;
- absence of HCL files.

## Integration stack

The `test/` directory contains a real Docker Registry, a fixture publisher, and the production Registry UI image.

```sh
cd test
docker compose up --build -d
./smoke.sh
docker compose down -v
```

The smoke test covers health, configuration, catalog enrichment, tags, multi-platform details, OCI and Docker archive downloads, and the `/v2/` proxy. Set `VERIFY_DOCKER_LOAD=1` to additionally run `docker image load` against the generated Docker archive; CI enables this validation.

See [test/README.md](../test/README.md) for the complete workflow.

## Container validation

```sh
docker build -f test/browser/Dockerfile --target runtime -t registry-ui:dev .
docker run --rm --read-only \
  -p 8080:8080 \
  -e REGISTRY_URL=http://host.docker.internal:5000 \
  registry-ui:dev
```

The release runtime is `scratch` and runs as UID/GID `65532`.

## Release

GoReleaser builds static Linux archives for `amd64` and `arm64`.

```sh
git tag -a v1.0.0 -m "registry-ui v1.0.0"
git push origin v1.0.0
```

The release workflow validates Go, frontend contracts, and static compilation before publishing artifacts and checksums.
