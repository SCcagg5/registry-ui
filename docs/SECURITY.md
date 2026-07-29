# Security model

## Deployment boundary

Registry UI is an administrative view over a Docker Registry. Deploy it behind the same authentication and network controls used for the registry itself.

The application does not implement end-user accounts or authorization policy. A user who can reach Registry UI may browse every repository allowed by the configured upstream credentials and can use the same-origin `/v2/*` proxy.

## Upstream credentials

Registry credentials are read only by the Go backend. They are added to server-side metadata requests and proxy requests when the incoming request does not already contain an `Authorization` header.

Credentials are never embedded in HTML, JavaScript, `config.json`, logs produced by the frontend, or download filenames.

Environment variables remain process-visible to users with sufficient access to the container runtime. Prefer the platform's secret injection mechanism for production values.

## TLS

HTTPS upstreams use the system CA bundle included in the release image. Certificate verification is not disabled by configuration.

Use HTTPS whenever Registry UI and the registry communicate over an untrusted network. Plain HTTP is appropriate only for a controlled container network such as the isolated integration stack.

## Deletion

Deletion is disabled by default and requires both:

- `DELETE_IMAGES=true`;
- an upstream registry that accepts manifest deletion.

The backend resolves the selected tag to its content digest and deletes that manifest digest. Registry garbage collection remains an independent operator responsibility.

## Same-origin proxy

The `/v2/*` endpoint forwards Docker Registry API requests to `REGISTRY_URL`. Do not expose Registry UI to an audience that should not have equivalent registry access.

The reverse proxy rewrites the upstream host and records the original host and protocol in `X-Forwarded-Host` and `X-Forwarded-Proto`.

## Browser assets

All frontend assets and icons are embedded and served from the same origin. There is no runtime CDN, remote font, analytics script, or third-party frontend request.

Responses set `X-Content-Type-Options`, `Referrer-Policy`, and `X-Frame-Options`. Deployments may add a stricter Content Security Policy at the outer reverse proxy.

## Filesystem and downloads

The application does not write local state, credentials, image layers, or archives to disk. OCI and Docker archive downloads are streamed directly from the upstream registry to the requesting client.

The `scratch` runtime supports a read-only root filesystem and runs as UID/GID `65532`.

## Trusted configuration

`REGISTRY_URL` is a trusted operator setting. It controls the upstream destination for backend requests and the `/v2/*` proxy. Do not allow untrusted users to modify process environment variables.
