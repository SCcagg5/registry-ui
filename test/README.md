# Integration test stack

This directory contains an isolated Docker Distribution registry, deterministic OCI image fixtures, and a Registry UI container wired through `REGISTRY_URL`.

The only application container build definition is `browser/Dockerfile`, matching the test-oriented layout used by S3 Browser. Application source remains under `src/`; no duplicate Dockerfile is kept there.

The stack exercises the production path end to end:

- Registry UI is built as the same static `scratch` image used for releases.
- Docker Distribution stores test content in a local named volume.
- The one-shot `seed` service publishes valid OCI image manifests, indexes, configs, and layers through the Registry HTTP API.
- The fixtures include single-platform and multi-platform images.
- Manifest deletion is enabled only inside this isolated stack.
- No HCL file, external registry, Docker socket, or production credential is used.

Start the stack:

```sh
docker compose up --build -d
```

Open:

```text
http://localhost:8080/
```

Run the smoke test:

```sh
./smoke.sh
```

To also verify the Docker archive with the local Docker Engine:

```sh
VERIFY_DOCKER_LOAD=1 ./smoke.sh
```

This loads, inspects, and removes only the deterministic `circular/registry-ui:v1.4.2` fixture.

To use another host port:

```sh
cp .env.example .env
# Edit REGISTRY_UI_PORT in .env.
docker compose up --build -d
```

Inspect logs:

```sh
docker compose logs -f registry-ui registry seed
```

Remove the complete test environment, including fixture data:

```sh
docker compose down -v
```

The named volume deliberately preserves fixtures across an ordinary `docker compose down`. Use `-v` whenever a completely clean registry is required.
