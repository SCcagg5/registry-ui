# Image and manifest support

## Supported manifests

Registry UI recognizes:

- OCI image manifests;
- OCI image indexes;
- Docker distribution manifest schema 2;
- Docker manifest lists.

Schema 1 manifests can be identified, but detailed config and layer inspection requires a schema 2 or OCI image config.

## Multi-platform images

For an OCI index or Docker manifest list, Registry UI reads every usable platform descriptor but displays the details for one platform at a time. The platform selector is also retained for single-platform images so creation time, author, platform size, operating system, architecture, and variant have one consistent location. Selecting another platform updates the detail panel locally without navigating or issuing another registry request.

The tag toolbar shows `Size`, meaning the cumulative image-content size across every platform, followed by the complete tag or index digest. Each platform button uses two aligned rows: platform and size first, then author and creation time.

The `Size` column on repository and tag lists uses the complete multi-platform image-content total. Repository totals add each distinct tagged manifest or index once, so two tags pointing to the same digest do not double-count it.

## Image configuration

The detail page reads the image config blob and displays:

- the full image and config digests with independent copy actions;
- user, working directory, entrypoint, and command in a runtime key/value table;
- labels in an adjacent two-thirds-width key/value table;
- detected build arguments and environment values as two numbered, syntax-colored source views;
- exposed ports in a compact third source column, one port per line.

The detail API also exposes declared volumes, the stop signal, and the root
filesystem type. These values are available to clients but are not currently
shown in the Runtime table.

Dockerfile-style instructions are reconstructed from OCI/Docker history entries. They are a readable representation of recorded history, not the original source Dockerfile.

The reconstruction:

- preserves the recorded instruction and filesystem-layer order;
- restores `FROM <name>` from `org.opencontainers.image.base.name` when present, otherwise starts the flattened reconstruction with `FROM scratch`;
- normalizes BuildKit representations such as `EXPOSE map[8080/tcp:{}]`;
- rebuilds `HEALTHCHECK` from the image's runtime configuration instead of displaying BuildKit's internal Go structure;
- uses conventional uppercase keywords, JSON exec form, spacing, continuation indentation, and blank lines between logical instruction groups;
- formats every `HEALTHCHECK` option on its own continued line before the command.

The reconstructed Dockerfile and image history share one ordered component. Numbered source remains on the left; cumulative size, signed layer change, and creation date form a compact, non-selectable three-column panel on the right. Copying the Dockerfile returns only instructions and blank lines.

## Image history and layers

The merged history contains every recorded item in its original order, including filesystem layers and configuration-only instructions such as `ENV`, `USER`, `WORKDIR`, `EXPOSE`, `STOPSIGNAL`, `ENTRYPOINT`, `CMD`, and `HEALTHCHECK`.

Filesystem rows contain the exact compressed layer descriptor size and cumulative filesystem size. Configuration rows leave the filesystem-change cell empty because they add no layer. OCI stores runtime configuration and history in one shared JSON blob, so there is no authoritative byte size for each individual metadata instruction.

`FROM` initializes a build stage but does not create a filesystem layer, so its own increase is always `0 B`. Every inherited base-image layer is nevertheless present in the final manifest and is displayed on the corresponding non-empty history entry with its exact descriptor size. The original base reference, such as `alpine:3.22`, cannot be recovered from flattened history unless the producer retained a standard `org.opencontainers.image.base.name` annotation or equivalent provenance.

Registry UI reads descriptors and configs for inspection. It does not unpack layers on the server.

## Size accounting

Registry UI defines image content as compressed layers plus the shared image configuration blob. The tag toolbar reports the sum of that value across all displayed platforms. Each platform selector button reports only its own image content.

Layer cumulative values intentionally include only filesystem layers. A BuildKit history instruction such as `ENTRYPOINT` therefore leaves the change column empty while remaining part of the shared configuration blob. Manifest and index sizes remain separate API metadata and are not silently folded into image content.

## Image archive downloads

`Download OCI` creates a valid OCI image-layout TAR stream containing:

- `oci-layout`;
- `index.json`;
- the selected image manifest;
- the config blob;
- referenced layer blobs.

For a multi-platform tag, the current download selects one platform rather than exporting the complete index. Selection prefers `linux/amd64`.

Archive content is streamed from the registry to the client. Registry UI does not create a temporary archive on disk.

The `.oci.tar` file is an OCI image-layout archive, not a root filesystem TAR and not the Docker image archive produced by the second download action. OCI-aware runtimes and image tools can import it directly.

The `Download` action for the selected platform creates a single-platform `.docker.tar`. It contains `manifest.json`, the image config, and all referenced layer blobs in Docker's load archive layout. Load it with:

```sh
docker image load --input image.docker.tar
```

The Docker archive is generated for the platform currently displayed. This avoids silently loading a different architecture from a multi-platform tag. Both archive formats are streamed directly from the registry and never written to the Registry UI filesystem.

## Bounds and failure behavior

Manifest and configuration reads are bounded. Invalid JSON, missing descriptors, unavailable blobs, unsupported media types, and upstream errors are returned as explicit API errors rather than silently fabricated metadata.
