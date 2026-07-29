# Architecture

## Runtime shape

Registry UI is one static Go binary with embedded HTML, CSS, JavaScript, SVG icons, and no frontend build step. The release container contains only:

- `/registry-ui`;
- the system CA certificate bundle.

The process does not require CGO, Node.js, Nginx, a writable root filesystem, a local database, or an application data volume.

## Request flow

The binary exposes three groups of endpoints:

1. The embedded frontend at `/` and `/assets/*`.
2. Enriched read APIs under `/api/*`.
3. A transparent same-origin Registry HTTP API V2 proxy under `/v2/*`.

Both backend API calls and the `/v2/*` reverse proxy use the single upstream configured by `REGISTRY_URL`.

```text
Browser
  ├── / and /assets/*     -> embedded frontend
  ├── /api/*              -> Registry UI metadata layer -> REGISTRY_URL
  └── /v2/*               -> same-origin proxy          -> REGISTRY_URL
```

The frontend never receives upstream registry credentials. When configured, authentication is added by the Go backend.

## Registry client

The metadata layer uses Docker Registry HTTP API V2 and OCI Distribution media types. It:

- pages through repositories and tags;
- enriches visible rows with manifest and config metadata;
- limits concurrent metadata enrichment;
- understands OCI image indexes and Docker manifest lists;
- reads image configs and layer descriptors;
- streams OCI and Docker load archive downloads without writing temporary files.

Repository and tag pages are enriched concurrently with a fixed upper bound. The application does not crawl the complete registry unless requested by the current page.

## Stateless model

Registry UI stores no application state on disk. Runtime memory contains only request-scoped metadata and a cached result for the registry deletion capability probe.

The registry remains the source of truth. Restarting Registry UI does not require migration or recovery.

## Path-prefix support

Frontend and API URLs are relative to the served document. A reverse proxy may publish the application below one prefix, for example `/registry-ui/`, as long as it removes that prefix before forwarding or forwards the request shape supported by the built-in prefix handler.

The configured `REGISTRY_URL` may independently include an upstream path prefix.

## Repository layout

```text
registry-ui/
├── docs/                   Architecture, configuration, development, and security
├── src/                    Go application and embedded frontend
├── test/                   Isolated Docker Compose integration stack
└── .github/workflows/      CI and release automation
```
