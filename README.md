# Registry UI

Registry UI is a self-contained browser for Docker Registry HTTP API V2 and OCI images. It ships as one static Go binary with an embedded frontend, an integrated same-origin registry proxy, and no runtime dependency on Node.js or Nginx.

The frontend keeps Registry UI's original page structure and navigation while adopting S3 Browser's visual system: colors, typography, spacing, radii, local Material Design SVG icons, menus, notifications, and responsive finish.

## Features

- Browse repositories and tags with server-side metadata enrichment.
- Open a repository's only tag directly, without an intermediate tag page.
- Inspect full image/config digests, type-aware colorized runtime settings and labels, colorized build arguments/environment values, exposed ports, and every ordered history entry.
- Switch platform details in place, with per-platform size, creation time, and author directly in the selector.
- Read a merged numbered Dockerfile/history view with sticky line numbers and cumulative size, signed layer change, and date kept outside selectable source.
- See the all-platform content `Size` and tag digest directly below the tag title.
- Download a tag as a streamed OCI archive or the selected platform as a Docker archive accepted by `docker image load`.
- Optionally delete manifest references when deletion is enabled and supported upstream.
- Proxy Docker Registry V2 requests through the same origin at `/v2/`.
- Run behind one reverse-proxy path prefix.
- Expose `/health`, `/healthz`, and `/ready`, plus a binary health command suitable for `scratch`.
- Build static Linux `amd64` and `arm64` release archives with GoReleaser.

All frontend assets are embedded and served locally. The application uses no CDN, external font, HCL file, generated `dist` directory, or frontend build step.

## Quick start

```sh
cd src
REGISTRY_URL=http://127.0.0.1:5000 go run .
```

Open:

```text
http://127.0.0.1:8080/
```

`REGISTRY_URL` is the only supported upstream URL variable.

## Integration test stack

The repository includes an isolated test environment equivalent in structure to S3 Browser:

```sh
cd test
docker compose up --build -d
./smoke.sh
```

Open `http://localhost:8080/`. The stack starts:

- the production Registry UI `scratch` image;
- a private Docker Distribution registry;
- a one-shot publisher that loads deterministic OCI single-platform and multi-platform fixtures.

Remove it completely with:

```sh
docker compose down -v
```

No external registry, Docker socket, production credential, or HCL configuration is required. See [test/README.md](test/README.md).

## Configuration

Configuration is environment-only.

| Variable | Default | Description |
| --- | --- | --- |
| `REGISTRY_URL` | `http://registry:5000` | Docker Registry upstream used by backend APIs and the `/v2/*` proxy. |
| `PORT` | `8080` | HTTP port when `LISTEN_ADDR` is unset. |
| `LISTEN_ADDR` | `:$PORT` | Complete HTTP listen address. |
| `REGISTRY_USERNAME` | empty | Optional upstream Basic Auth username. |
| `REGISTRY_PASSWORD` | empty | Optional upstream Basic Auth password. |
| `REGISTRY_BASIC_AUTH` | empty | Optional complete Basic authorization value. |
| `REGISTRY_TOKEN` | empty | Optional upstream Bearer token. |
| `DELETE_IMAGES` | `false` | Enables deletion when the upstream also supports it. |
| `HEALTH_URL` | local `/healthz` | URL used by `registry-ui health`. |
| `HEALTH_TIMEOUT` | `2s` | Timeout used by the health command. |

`REGISTRY_URL` accepts HTTP, HTTPS, custom ports, and an upstream path prefix:

```sh
REGISTRY_URL=https://registry.example.com:5443/internal go run .
```

See [docs/CONFIGURATION.md](docs/CONFIGURATION.md) for authentication precedence and all runtime details.

## Docker

Build the `scratch` image:

```sh
docker build \
  -f test/browser/Dockerfile \
  --target runtime \
  --build-arg VERSION=v1.0.0 \
  -t registry-ui:v1.0.0 \
  .
```

Run it:

```sh
docker run --rm \
  --name registry-ui \
  --read-only \
  -p 8080:8080 \
  -e REGISTRY_URL=http://registry:5000 \
  registry-ui:v1.0.0
```

The final container runs as UID/GID `65532`, includes CA certificates for HTTPS registries, and uses the binary itself for health checks.

## HTTP endpoints

| Endpoint | Purpose |
| --- | --- |
| `/` | Registry browser. |
| `/config.json`, `/api/config` | Public frontend configuration. |
| `/api/catalog` | Enriched repository catalog. |
| `/api/tags` | Enriched tags for one repository. |
| `/api/tag` | Detailed image metadata. |
| `/api/download` | OCI image archive download. |
| `/api/download/docker` | Docker image archive download for one selected platform. |
| `/api/delete` | Manifest reference deletion. |
| `/v2/` | Same-origin Docker Registry proxy. |
| `/health`, `/healthz`, `/ready` | Process health endpoints. |

Frontend and API URLs are relative, so the application supports a reverse-proxy prefix such as:

```text
https://example.com/registry-ui/
```

## Health command

```sh
registry-ui health
registry-ui health --quiet
registry-ui health --url http://127.0.0.1:8080/healthz --timeout 3s
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Configuration](docs/CONFIGURATION.md)
- [Development and validation](docs/DEVELOPMENT.md)
- [Image and manifest support](docs/IMAGE_SUPPORT.md)
- [Security model](docs/SECURITY.md)

## Project structure

```text
registry-ui/
├── .github/
│   └── workflows/
│       ├── ci.yaml
│       └── release.yaml
├── docs/
│   ├── ARCHITECTURE.md
│   ├── CONFIGURATION.md
│   ├── DEVELOPMENT.md
│   ├── IMAGE_SUPPORT.md
│   └── SECURITY.md
├── src/
│   ├── public/
│   │   ├── assets/
│   │   │   ├── css/
│   │   │   ├── icons/mdi/
│   │   │   └── js/
│   │   ├── favicon.svg
│   │   └── index.html
│   ├── go.mod
│   ├── main.go
│   └── main_test.go
├── test/
│   ├── browser/Dockerfile
│   ├── seed/
│   ├── docker-compose.yaml
│   ├── frontend-contract.mjs
│   ├── tag-detail-format.mjs
│   ├── README.md
│   └── smoke.sh
├── LICENSE
└── README.md
```

## Development

Run the complete local verification:

```sh
cd src
test -z "$(gofmt -l *.go)"
go test -race ./...
go vet ./...
node --check public/assets/js/api.js
node --check public/assets/js/app.js
node --check ../test/tag-detail-format.mjs
node ../test/frontend-contract.mjs
node ../test/tag-detail-format.mjs
CGO_ENABLED=0 go build -tags=netgo,osusergo -trimpath .
```

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for fixture, integration, and release validation.

## Release

Create and push a semantic version tag:

```sh
git tag -a v1.0.0 -m "registry-ui v1.0.0"
git push origin v1.0.0
```

The release workflow runs formatting, tests, vetting, frontend contracts, static compilation, and GoReleaser. It publishes Linux archives for `amd64` and `arm64` with a checksum file.

## License

AGPL-3.0.
