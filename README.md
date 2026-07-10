# registry-ui

`registry-ui` is a minimal Docker Registry browser with a structure close to S3 Browser: one Go server, embedded static frontend assets, no Node runtime, no Nginx layer, no generated `dist` directory, and no extra demo files.

## Features

- Standalone Go binary.
- Embedded frontend from `src/public`.
- Same-origin `/v2` proxy to a Docker Registry.
- Backend-batched catalog and tag metadata endpoints.
- Relative frontend calls, so the UI works behind a reverse-proxy path such as `/registry-ui/`.
- Health endpoints: `/health`, `/healthz`, `/ready`.
- CLI health command for `scratch` images: `registry-ui health`.
- Optional manifest deletion when both `DELETE_IMAGES=true` and the upstream registry supports deletion.
- OCI image archive download for a selected tag.

## Structure

```text
registry-ui/
├── README.md
├── LICENSE
├── .gitignore
├── .github/
│   └── workflows/
│       └── release.yaml
└── src/
    ├── .dockerignore
    ├── .goreleaser.yaml
    ├── Dockerfile
    ├── go.mod
    ├── main.go
    └── public/
        ├── index.html
        └── assets/
            ├── css/
            │   ├── style.css
            │   └── ui.css
            └── js/
                ├── api.js
                └── app.js
```

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `8080` | HTTP port. |
| `LISTEN_ADDR` | `:$PORT` | Full listen address. |
| `REGISTRY_PROXY_PASS_URL` | `http://registry:5000` | Docker Registry upstream used by the same-origin proxy and backend API. |
| `REGISTRY_URL` | alias | Compatibility alias for `REGISTRY_PROXY_PASS_URL`. |
| `NGINX_PROXY_PASS_URL` | alias | Compatibility alias for `REGISTRY_PROXY_PASS_URL`. |
| `REGISTRY_USERNAME` / `REGISTRY_PASSWORD` | empty | Optional upstream Basic Auth credentials. |
| `REGISTRY_BASIC_AUTH` | empty | Optional prebuilt auth header value, for example `Basic xxxxx`. |
| `REGISTRY_TOKEN` | empty | Optional upstream Bearer token. |
| `DELETE_IMAGES` | `false` | Enables the delete action only when the upstream registry also supports manifest deletion. |
| `HEALTH_URL` | local `/healthz` | URL used by `registry-ui health`. |
| `HEALTH_TIMEOUT` | `2s` | Timeout used by the health command. |

Pagination is selected in the frontend with fixed choices: `25`, `50`, or `100`.

## Local run

```bash
cd src
go run .
```

With a local registry:

```bash
cd src
REGISTRY_PROXY_PASS_URL=http://localhost:5000 go run .
```

Open `http://localhost:8080`.

## Scratch image

```bash
cd src
docker build --build-arg VERSION=v0.1.0 -t registry-ui:v0.1.0 .

docker run --rm -p 8080:8080 \
  -e REGISTRY_PROXY_PASS_URL=http://registry:5000 \
  registry-ui:v0.1.0
```

The final image uses `FROM scratch`. The Docker healthcheck calls the binary itself:

```dockerfile
HEALTHCHECK CMD ["/registry-ui", "health", "--quiet"]
```

## Health

```bash
registry-ui health
registry-ui health --quiet
registry-ui health --url http://127.0.0.1:8080/healthz --timeout 3s
```

Endpoints:

```text
/health
/healthz
/ready
```

## Release v0.1.0

After the first push to GitHub:

```bash
git tag -a v0.1.0 -m "registry-ui v0.1.0"
git push origin v0.1.0
```

The `.github/workflows/release.yaml` workflow runs GoReleaser and publishes Linux `amd64` and `arm64` archives.

## License

AGPL-3.0.
