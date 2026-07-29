import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = join(root, "src", "public", "assets", "js", "app.js");
const source = readFileSync(sourcePath, "utf8");
const normalizedSource = source.trimEnd();
const marker = "})();";

assert.ok(normalizedSource.endsWith(marker), "unexpected app.js wrapper");

const instrumented = normalizedSource.slice(0, -marker.length) + `
  window.__tagDetailTest = {
    buildDockerfileLines,
    els,
    footer,
    formatBytesText,
    formatHistoryBytes,
    formatSizeChange,
    highlightConfigAssignment,
    highlightExposedPort,
    highlightDockerInstruction,
    renderDigestRow,
    renderDockerHistoryEditor,
    renderImageDetail,
    renderKeyValueRows,
    renderKeyValueTable,
    renderNumberedValues,
    renderExposedPorts,
    renderPlatformSelector,
    renderTags,
    renderTagToolbar,
    renderTypedValue,
    state,
    wrapDockerInstruction
  };
})();`;

const sandbox = {
  console,
  document: {
    addEventListener() {},
    querySelector() { return null; }
  },
  localStorage: {
    getItem() { return null; },
    setItem() {}
  },
  window: {
    RegistryUIApi: {
      downloadURL(repo, tag) {
        return `/api/download?repo=${encodeURIComponent(repo)}&tag=${encodeURIComponent(tag)}`;
      },
      dockerDownloadURL(repo, tag, digest) {
        return `/api/download/docker?repo=${encodeURIComponent(repo)}&tag=${encodeURIComponent(tag)}&digest=${encodeURIComponent(digest)}`;
      }
    }
  }
};

vm.runInNewContext(instrumented, sandbox, { filename: sourcePath });
const ui = sandbox.window.__tagDetailTest;

function fakeElement() {
  const classes = new Set(["hidden"]);
  return {
    innerHTML: "",
    classList: {
      add(name) { classes.add(name); },
      contains(name) { return classes.has(name); },
      remove(name) { classes.delete(name); }
    },
    replaceChildren() { this.innerHTML = ""; }
  };
}

ui.els.viewMeta = fakeElement();
ui.els.tagToolbarActions = fakeElement();
ui.state.config = { deleteEnabled: true };
ui.renderTagToolbar({
  repository: "circular/registry-ui",
  tag: "1.0.0",
  digest: "sha256:tag",
  size: 5_900_000
});
assert.ok(ui.els.viewMeta.innerHTML.indexOf(">Size<") < ui.els.viewMeta.innerHTML.indexOf(">Digest<"));
assert.doesNotMatch(ui.els.viewMeta.innerHTML, /Cumulative size/);
assert.match(ui.els.viewMeta.innerHTML, /5\.6 MB/);
assert.match(ui.els.tagToolbarActions.innerHTML, /Download OCI/);
assert.match(ui.els.tagToolbarActions.innerHTML, /Delete/);
assert.equal(ui.els.viewMeta.classList.contains("hidden"), false);
assert.equal(ui.els.tagToolbarActions.classList.contains("hidden"), false);

const healthcheck = 'HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD ["/registry-ui", "health", "--quiet"]';
assert.deepEqual(
  Array.from(ui.wrapDockerInstruction(healthcheck)),
  [
    "HEALTHCHECK --interval=30s \\",
    "            --timeout=3s \\",
    "            --start-period=5s \\",
    "            --retries=3 \\",
    '            CMD ["/registry-ui", "health", "--quiet"]'
  ]
);

const instructions = [
  {
    line: 1,
    instruction: "FROM scratch",
    createdAt: "2026-07-29T14:57:00Z",
    synthetic: true,
    layerIndex: -1,
    cumulativeSize: 0
  },
  {
    line: 2,
    instruction: "ENV PORT=8080",
    createdAt: "2026-07-29T14:57:00Z",
    layerIndex: -1,
    cumulativeSize: 0
  },
  {
    line: 3,
    instruction: "COPY /out/rootfs/ /",
    createdAt: "2026-07-29T14:57:00Z",
    layerIndex: 1,
    layerDigest: "sha256:layer",
    layerSize: 2_900_000,
    cumulativeSize: 2_900_000
  },
  {
    line: 4,
    instruction: healthcheck,
    createdAt: "2026-07-29T14:57:00Z",
    layerIndex: -1,
    cumulativeSize: 2_900_000
  }
];

const dockerfile = Array.from(ui.buildDockerfileLines(instructions));
assert.equal(dockerfile[0], "FROM scratch");
assert.ok(dockerfile.includes(""), "Dockerfile groups must retain blank separator lines");
assert.ok(dockerfile.indexOf("ENV PORT=8080") < dockerfile.indexOf("COPY /out/rootfs/ /"), "OCI instruction order changed");
assert.ok(dockerfile.indexOf("COPY /out/rootfs/ /") < dockerfile.indexOf("HEALTHCHECK --interval=30s \\"), "OCI layer order changed");

const history = ui.renderDockerHistoryEditor(instructions);
assert.match(history, /Reconstructed Dockerfile and image history/);
assert.match(history, /class="docker-source-pane"/);
assert.match(history, /class="docker-history-meta-pane"/);
assert.ok(history.indexOf('class="docker-source-pane"') < history.indexOf('class="docker-history-meta-pane"'));
assert.match(history, /history-meta-total/);
assert.match(history, /history-meta-change is-positive/);
assert.match(history, /\+2\.8 MB/);
assert.match(history, /history-meta-date/);
assert.match(history, /history-meta-header/);
assert.ok(history.indexOf('class="history-meta-header"') < history.indexOf('class="docker-history-body"'));
assert.match(history, /style="--history-row-lines: 5"/);
assert.match(history, />Size</);
assert.match(history, />Date</);
assert.doesNotMatch(history, /docker-source-header/);
assert.match(history, /history-size-number/);
assert.match(history, /history-size-unit/);
assert.doesNotMatch(history, /<d[dt]>/);
assert.match(history, /aria-label="Stage, total size 0 B, no filesystem size change,/);
assert.doesNotMatch(history, /\+0 B/);
assert.doesNotMatch(history, /Inferred/i);
assert.equal(ui.formatSizeChange(1_024), "+1.0 KB");
assert.equal(ui.formatSizeChange(-1_024), "-1.0 KB");
assert.equal(ui.formatSizeChange(0), "");
assert.equal(ui.formatHistoryBytes(19 * 1024 * 1024).text, "19.0 MB");
assert.equal(ui.formatHistoryBytes(3.8 * 1024 * 1024).text, "3.8 MB");
assert.equal(ui.formatHistoryBytes(284).text, "284.0 B");
assert.equal(ui.formatHistoryBytes(0).text, "0 B");
assert.equal(ui.formatBytesText(19 * 1024 * 1024), "19.0 MB");

const highlighted = ui.highlightDockerInstruction('ENTRYPOINT ["/registry-ui", "health"]');
assert.match(highlighted, /docker-keyword/);
assert.match(highlighted, /docker-string/);

const registryInstall = `RUN set -eux; version='3.0.0'; apkArch="$(apk --print-arch)"; wget registry.tar.gz`;
assert.deepEqual(Array.from(ui.wrapDockerInstruction(registryInstall)), [registryInstall]);
assert.match(ui.highlightDockerInstruction(registryInstall), /docker-keyword">RUN<\/span> set -eux/);

const registryInstallFlattened = `RUN set -eux; \tversion='3.0.0'; \tapkArch="$(apk --print-arch)"; \tcase "$apkArch" in \t\tx86_64)  arch='amd64';   sha256='61c9a2c0d5981a78482025b6b69728521fbc78506d68b223d4a2eb825de5ca3d' ;; \t\taarch64) arch='arm64';   sha256='6c2ee1d135626fa42e0d6fb66a0e0f42e22439e5050087d04f4c5ff53655892e' ;; \t\tarmhf)   arch='armv6';   sha256='e038bba14c573628407d9f5dfa6b6f9d782acda62abf52dbf24ab257bbeedfe7' ;; \t\tarmv7)   arch='armv7';   sha256='147d617e604e2e7d11b055484493c6a20731f6ce252d2bc47c716d8c48258719' ;; \t\tppc64le) arch='ppc64le'; sha256='5386e9811790616d5b3c4d5de2f449e6da99f03dd45f33ee3e3464e81a264e6e' ;; \t\ts390x)   arch='s390x';   sha256='c8645e6fcebde5a441e1050c673b3ffa38572f61c1d1b1605d2bf333d3760328' ;; \t\triscv64) arch='riscv64'; sha256='99bfeef7c553bf7b9861435e6b55fa584ecca73704f4a71418e482cc2d9e013d' ;; \t\t*) echo >&2 "error: unsupported architecture: $apkArch"; exit 1 ;; \tesac; \twget -O registry.tar.gz "https://github.com/distribution/distribution/releases/download/v\${version}/registry_\${version}_linux_\${arch}.tar.gz"; \techo "$sha256 *registry.tar.gz" | sha256sum -c -; \ttar --extract --verbose --file registry.tar.gz --directory /bin/ registry; \trm registry.tar.gz; \tregistry --version`;
const registryInstallLines = Array.from(ui.wrapDockerInstruction(registryInstallFlattened));
assert.deepEqual(
  registryInstallLines,
  [
    "RUN set -eux; \\",
    "    version='3.0.0'; \\",
    '    apkArch="$(apk --print-arch)"; \\',
    '    case "$apkArch" in \\',
    "        x86_64) arch='amd64'; sha256='61c9a2c0d5981a78482025b6b69728521fbc78506d68b223d4a2eb825de5ca3d' ;; \\",
    "        aarch64) arch='arm64'; sha256='6c2ee1d135626fa42e0d6fb66a0e0f42e22439e5050087d04f4c5ff53655892e' ;; \\",
    "        armhf) arch='armv6'; sha256='e038bba14c573628407d9f5dfa6b6f9d782acda62abf52dbf24ab257bbeedfe7' ;; \\",
    "        armv7) arch='armv7'; sha256='147d617e604e2e7d11b055484493c6a20731f6ce252d2bc47c716d8c48258719' ;; \\",
    "        ppc64le) arch='ppc64le'; sha256='5386e9811790616d5b3c4d5de2f449e6da99f03dd45f33ee3e3464e81a264e6e' ;; \\",
    "        s390x) arch='s390x'; sha256='c8645e6fcebde5a441e1050c673b3ffa38572f61c1d1b1605d2bf333d3760328' ;; \\",
    "        riscv64) arch='riscv64'; sha256='99bfeef7c553bf7b9861435e6b55fa584ecca73704f4a71418e482cc2d9e013d' ;; \\",
    '        *) echo >&2 "error: unsupported architecture: $apkArch"; exit 1 ;; \\',
    "    esac; \\",
    '    wget -O registry.tar.gz "https://github.com/distribution/distribution/releases/download/v${version}/registry_${version}_linux_${arch}.tar.gz"; \\',
    '    echo "$sha256 *registry.tar.gz" | sha256sum -c -; \\',
    "    tar --extract --verbose --file registry.tar.gz --directory /bin/ registry; \\",
    "    rm registry.tar.gz; \\",
    "    registry --version"
  ]
);
assert.ok(registryInstallLines.slice(0, -1).every((line) => line.endsWith(" \\")));
assert.ok(registryInstallLines.every((line) => !line.includes("\t")));
assert.deepEqual(
  Array.from(ui.wrapDockerInstruction(`RUN printf '%s;  %s' "left  value" right; echo done`)),
  [
    `RUN printf '%s;  %s' "left  value" right; \\`,
    "    echo done"
  ],
  "semicolons and repeated spaces inside strings must not create false line breaks"
);

const unavailable = Array.from(ui.buildDockerfileLines([{
  instruction: "",
  layerIndex: 7,
  layerDigest: "sha256:unknown",
  layerSize: 12
}]));
assert.deepEqual(unavailable, ["# OCI layer 7 instruction unavailable"]);

const environment = ui.renderNumberedValues(["PORT=8080", "MODE=production"], "empty");
assert.match(environment, /config-code-lines/);
assert.match(environment, /config-code-row/);
assert.match(environment, /config-line-number[^>]*>1<\/span>/);
assert.match(environment, /config-line-number[^>]*>2<\/span>/);
assert.match(environment, /config-line-code/);
assert.match(environment, /config-key[^>]*>PORT</);
assert.match(environment, /config-value[^>]*>8080</);
assert.ok(environment.indexOf(">PORT<") < environment.indexOf(">MODE<"));

const exposed = ui.renderExposedPorts(["8080/tcp", "8443/tcp"]);
assert.match(exposed, /exposed-source/);
assert.match(exposed, /config-number[^>]*>8080</);
assert.match(exposed, /config-value[^>]*>tcp</);
assert.ok(exposed.indexOf(">8080<") < exposed.indexOf(">8443<"));

const image = {
  platform: "linux/amd64",
  digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  configDigest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  mediaType: "application/vnd.oci.image.manifest.v1+json",
  size: 2_900_857,
  configSize: 857,
  createdAt: "2026-07-29T14:57:00Z",
  author: "Circular",
  user: "65532:65532",
  workingDir: "/",
  entrypoint: ["/registry-ui"],
  cmd: ["serve"],
  env: ["PORT=8080"],
  args: ["VERSION=1.0.0"],
  exposedPorts: ["8080/tcp"],
  labels: { "org.opencontainers.image.version": "1.0.0" },
  instructions
};

const platform = ui.renderPlatformSelector([image]);
assert.match(platform, /platform-button-platform[^>]*>linux\/amd64</);
assert.match(platform, /platform-button-author[^>]*>Circular</);
assert.match(platform, /platform-button-date[^>]*>2026\/07\/29 \d{2}h57</);
assert.match(platform, /2\.8 MB/);
assert.doesNotMatch(platform, />Platforms?<|Choose one image to inspect/);

ui.state.tagDetail = {
  repository: "circular/registry-ui",
  tag: "1.0.0"
};
const detail = ui.renderImageDetail(image, 0);
assert.match(detail, new RegExp(image.digest));
assert.match(detail, new RegExp(image.configDigest));
assert.match(detail, /runtime-label-grid/);
assert.match(detail, /config-source-grid/);
assert.ok(detail.indexOf("<h4>Build args</h4>") < detail.indexOf("<h4>Environment</h4>"));
assert.match(detail, /<h4>Exposed<\/h4>/);
assert.match(detail, /8080/);
assert.match(detail, /<h4>Dockerfile<\/h4>/);
assert.doesNotMatch(detail, /section-note|Instructions remain in OCI order/);
assert.match(detail, /toolbar-digest digest-row/);
assert.match(detail, /class="image-detail-actions"/);
assert.match(detail, /class="image-title-row"[\s\S]*linux\/amd64[\s\S]*class="badge"/);
assert.match(detail, /class="btn small docker-download"/);
assert.match(detail, /api\/download\/docker/);
assert.match(detail, /docker image load/);
assert.match(detail, /typed-number[^>]*>65532</);
assert.match(detail, /typed-path[^>]*>\/</);
assert.match(detail, /typed-string[^>]*>&quot;\/registry-ui&quot;</);
assert.match(detail, /typed-string[^>]*>1\.0\.0</);
assert.doesNotMatch(detail, /summary-grid|OCI content|Image history<\/h4>[\s\S]*Reconstructed Dockerfile/);

assert.match(ui.renderTypedValue(true), /typed-boolean[^>]*>true</);
assert.match(ui.renderTypedValue(42), /typed-number[^>]*>42</);
assert.match(ui.renderTypedValue("https://example.test"), /typed-url/);
assert.match(ui.renderTypedValue("sha256:abcdef"), /typed-digest/);
assert.match(ui.renderTypedValue([]), /class="muted"/);
assert.doesNotMatch(ui.renderTypedValue("<img src=x>"), /<img/);
assert.match(ui.renderKeyValueTable({ enabled: "true", replicas: "3" }, "empty"), /typed-boolean[\s\S]*typed-number/);

const digests = ui.renderDigestRow("Digest", image.digest, "Copy image digest");
assert.match(digests, /class="toolbar-digest digest-row"/);
assert.match(digests, new RegExp(image.digest));

const repositoriesNavigation = ui.footer("12 repositories", "next", "catalog-more", "repositories", "table-navigation");
assert.match(repositoriesNavigation, /table-navigation/);
assert.match(repositoriesNavigation, /repositories per page/);
assert.ok(repositoriesNavigation.indexOf("repositories per page") < repositoriesNavigation.indexOf("12 repositories"));

const tagsNavigation = ui.footer("12 tags", "next", "tags-more", "tags", "table-navigation");
assert.match(tagsNavigation, /table-navigation/);
assert.match(tagsNavigation, /tags per page/);
assert.ok(tagsNavigation.indexOf("tags per page") < tagsNavigation.indexOf("12 tags"));

ui.els.content = fakeElement();
ui.state.repo = "infrastructure/registry";
ui.state.tagsCursor = "next";
ui.state.loading = false;
ui.state.filter = "";
ui.state.tags = [
  {
    name: "3.0.0",
    digest: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    platforms: ["linux/amd64"],
    size: 1_024,
    createdAt: "2026-07-29T14:57:00Z"
  },
  {
    name: "stable",
    digest: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    platforms: ["linux/arm64"],
    size: 2_048,
    createdAt: "2026-07-29T15:57:00Z"
  }
];
ui.renderTags();
assert.ok(ui.els.content.innerHTML.indexOf("tags per page") < ui.els.content.innerHTML.indexOf('<div class="table-wrap">'));
assert.match(ui.els.content.innerHTML, /2 tags/);

ui.state.filter = "stable";
ui.renderTags();
assert.match(ui.els.content.innerHTML, /data-tag="stable"/);
assert.doesNotMatch(ui.els.content.innerHTML, /data-tag="3\.0\.0"/);
assert.match(ui.els.content.innerHTML, /1 tag/);

console.log("tag detail formatting ok");
