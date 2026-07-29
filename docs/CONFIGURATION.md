# Configuration

Registry UI is configured only with environment variables. It does not read HCL or another application configuration file.

## Registry upstream

| Variable | Default | Description |
| --- | --- | --- |
| `REGISTRY_URL` | `http://registry:5000` | Complete HTTP or HTTPS URL of the Docker Registry upstream. |

`REGISTRY_URL` is the only supported upstream URL variable.

Accepted examples:

```sh
REGISTRY_URL=http://registry:5000
REGISTRY_URL=https://registry.example.com
REGISTRY_URL=https://registry.example.com:5443/internal
```

The value must contain a scheme and host. A trailing slash is removed. A path prefix is preserved for metadata requests and `/v2/*` proxy requests.

## Upstream authentication

| Variable | Default | Description |
| --- | --- | --- |
| `REGISTRY_BASIC_AUTH` | empty | Complete Basic authorization value, with or without the `Basic ` prefix. |
| `REGISTRY_TOKEN` | empty | Bearer token. |
| `REGISTRY_USERNAME` | empty | Basic authentication username. |
| `REGISTRY_PASSWORD` | empty | Basic authentication password. |

Authentication precedence is:

1. `REGISTRY_BASIC_AUTH`;
2. `REGISTRY_TOKEN`;
3. `REGISTRY_USERNAME` and `REGISTRY_PASSWORD`.

Credentials stay in the backend process and are never included in `config.json` or frontend assets.

## HTTP server

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `8080` | Listen port when `LISTEN_ADDR` is unset. |
| `LISTEN_ADDR` | `:$PORT` | Complete Go HTTP listen address. |
| `DELETE_IMAGES` | `false` | Enables manifest deletion after the upstream capability probe succeeds. |

Examples:

```sh
PORT=8080
LISTEN_ADDR=127.0.0.1:8080
DELETE_IMAGES=true
```

`DELETE_IMAGES=true` does not override the registry policy. The delete action appears only when the upstream accepts manifest deletion.

## Health command

| Variable | Default | Description |
| --- | --- | --- |
| `HEALTH_URL` | `http://127.0.0.1:$PORT/healthz` | URL checked by `registry-ui health`. |
| `HEALTH_TIMEOUT` | `2s` | Health request timeout. |

The HTTP server exposes `/health`, `/healthz`, and `/ready`. These endpoints report process health; they do not perform a registry-wide scan.

## Docker example

```sh
docker run --rm \
  --name registry-ui \
  --read-only \
  -p 8080:8080 \
  -e REGISTRY_URL=https://registry.example.com \
  -e DELETE_IMAGES=false \
  registry-ui:v1.0.0
```

No configuration file or writable volume is required.
