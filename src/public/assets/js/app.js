(() => {
  "use strict";

  const api = window.RegistryUIApi;
  const $ = (selector) => document.querySelector(selector);

  const PAGE_SIZES = [25, 50, 100];
  const DOCKERFILE_WRAP_COLUMN = 120;

  const state = {
    config: null,
    view: "repositories",
    repo: "",
    tag: "",
    repositories: [],
    tags: [],
    tagDetail: null,
    selectedImageIndex: 0,
    catalogCursor: "",
    tagsCursor: "",
    filter: "",
    pageSize: Number(localStorage.getItem("registry-ui-page-size") || 25),
    loading: false,
    error: ""
  };

  const els = {};

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    cacheElements();
    normalizePageSize();
    bindEvents();
    await loadConfig();
    window.addEventListener("hashchange", navigate);
    await navigate();
  }

  function cacheElements() {
    els.versionBadge = $("#versionBadge");
    els.viewHeader = $("#viewHeader");
    els.backBtn = $("#backBtn");
    els.viewTitle = $("#viewTitle");
    els.viewMeta = $("#viewMeta");
    els.searchInput = $("#searchInput");
    els.searchField = $("#searchField");
    els.tagToolbarActions = $("#tagToolbarActions");
    els.notice = $("#notice");
    els.content = $("#content");
    els.toast = $("#toast");
    els.toastIcon = $("#toastIcon");
    els.toastMessage = $("#toastMessage");
    els.confirmOverlay = $("#confirmOverlay");
    els.confirmClose = $("#confirmClose");
    els.confirmCancel = $("#confirmCancel");
    els.confirmDelete = $("#confirmDelete");
    els.confirmReference = $("#confirmReference");
  }

  function bindEvents() {
    els.backBtn.addEventListener("click", goBack);
    els.searchInput.addEventListener("input", () => {
      state.filter = els.searchInput.value.trim().toLowerCase();
      renderContent();
    });
    els.confirmClose.addEventListener("click", () => closeConfirm(false));
    els.confirmCancel.addEventListener("click", () => closeConfirm(false));
    els.confirmDelete.addEventListener("click", () => closeConfirm(true));
    els.confirmOverlay.addEventListener("click", (event) => {
      if (event.target === els.confirmOverlay) closeConfirm(false);
    });
    document.addEventListener("click", onDocumentClick);
    document.addEventListener("change", onDocumentChange);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeMenus();
        closeConfirm(false);
      }
    });
    window.addEventListener("resize", closeMenus);
    window.addEventListener("scroll", closeMenus, true);
  }

  function normalizePageSize() {
    if (!PAGE_SIZES.includes(state.pageSize)) state.pageSize = 25;
  }

  async function loadConfig() {
    try {
      state.config = await api.config();
    } catch (_) {
      state.config = {
        name: "registry-ui",
        version: "dev",
        proxyEnabled: true,
        deleteEnabled: false
      };
    }
  }

  async function navigate() {
    const route = parseRoute();
    state.view = route.view;
    state.repo = route.repo || "";
    state.tag = route.tag || "";
    releaseInactiveState(route.view);
    state.filter = "";
    state.error = "";
    state.tagDetail = null;
    state.selectedImageIndex = 0;
    els.searchInput.value = "";
    closeMenus();
    renderChrome();
    renderNotice();

    if (state.view === "tag-detail") await loadTagDetail();
    else if (state.view === "tags") await loadTags(false);
    else await loadCatalog(false);
  }

  function parseRoute() {
    const hash = window.location.hash || "#/";
    const prefix = "#/repository/";
    if (hash.startsWith(prefix)) {
      const rest = hash.slice(prefix.length);
      const tagMarker = "/tag/";
      const markerIndex = rest.indexOf(tagMarker);
      if (markerIndex >= 0) {
        return {
          view: "tag-detail",
          repo: decodeURIComponent(rest.slice(0, markerIndex)),
          tag: decodeURIComponent(rest.slice(markerIndex + tagMarker.length))
        };
      }
      return { view: "tags", repo: decodeURIComponent(rest), tag: "" };
    }
    return { view: "repositories", repo: "", tag: "" };
  }

  function setRouteRepositories() { window.location.hash = "#/"; }
  function setRouteRepository(repo) { window.location.hash = `#/repository/${encodeURIComponent(repo)}`; }
  function setRouteTag(repo, tag) { window.location.hash = `#/repository/${encodeURIComponent(repo)}/tag/${encodeURIComponent(tag)}`; }

  function goBack() {
    if (state.view === "tag-detail") {
      if (state.tagDetail && state.tagDetail.singleTag) setRouteRepositories();
      else setRouteRepository(state.repo);
    }
    else if (state.view === "tags") setRouteRepositories();
  }

  function releaseInactiveState(nextView) {
    if (nextView === "repositories") {
      state.tags = [];
      state.tagDetail = null;
      state.tagsCursor = "";
    } else if (nextView === "tags") {
      state.repositories = [];
      state.tags = [];
      state.tagDetail = null;
      state.catalogCursor = "";
      state.tagsCursor = "";
    } else {
      state.repositories = [];
      state.tags = [];
      state.catalogCursor = "";
      state.tagsCursor = "";
    }
  }

  function renderChrome() {
    const cfg = state.config || {};
    const isRepositories = state.view === "repositories";
    const isTags = state.view === "tags";
    const isTagDetail = state.view === "tag-detail";
    const isSearchableList = isRepositories || isTags;

    document.title = isTagDetail
      ? `${state.repo}:${state.tag} · Registry UI`
      : isTags
        ? `${state.repo} · Registry UI`
        : "Registry UI";

    const versionLabel = cfg.version || "dev";
    const versionText = els.versionBadge.querySelector("span");
    if (versionText) versionText.textContent = versionLabel;
    els.versionBadge.title = `Registry UI release ${versionLabel}`;
    els.backBtn.classList.toggle("is-placeholder", isRepositories);
    els.backBtn.disabled = isRepositories;
    els.viewHeader.classList.toggle("hidden", isRepositories);
    els.viewTitle.textContent = isTagDetail ? `${state.repo}:${state.tag}` : isTags ? state.repo : "Repositories";
    els.searchField.classList.toggle("hidden", !isSearchableList);
    els.viewMeta.classList.add("hidden");
    els.viewMeta.replaceChildren();
    els.tagToolbarActions.classList.add("hidden");
    els.tagToolbarActions.replaceChildren();
    const searchLabel = isTags ? "Search tags" : "Search repositories";
    const accessibleLabel = els.searchField.querySelector(".sr-only");
    if (accessibleLabel) accessibleLabel.textContent = searchLabel;
    els.searchInput.placeholder = isTags ? "Tag" : "Image or namespace";
    els.searchInput.setAttribute("aria-label", searchLabel);
  }

  function renderNotice() {
    const cfg = state.config || {};
    const needsConfig = !cfg.proxyEnabled;
    if (needsConfig) {
      els.notice.className = "notice warn";
      els.notice.innerHTML = `${icon("alert-circle-outline")}<span>No registry is configured. Set <code>REGISTRY_URL</code>.</span>`;
      return;
    }
    els.notice.className = "notice hidden";
    els.notice.replaceChildren();
  }

  async function reloadCurrent() {
    if (state.view === "tag-detail") await loadTagDetail();
    else if (state.view === "tags") await loadTags(false);
    else await loadCatalog(false);
  }

  async function loadCatalog(append) {
    state.loading = true;
    state.error = "";
    renderContent();
    try {
      const cursor = append ? state.catalogCursor : "";
      const { data } = await api.catalog({ pageSize: state.pageSize, cursor });
      const incoming = Array.isArray(data.repositories) ? data.repositories : [];
      state.repositories = append ? uniqueByName([...state.repositories, ...incoming]) : incoming;
      state.catalogCursor = data.next || "";
      if (typeof data.deleteEnabled === "boolean") state.config.deleteEnabled = data.deleteEnabled;
    } catch (error) {
      state.error = error.message || String(error);
      if (!append) state.repositories = [];
      state.catalogCursor = "";
    } finally {
      state.loading = false;
      renderContent();
    }
  }

  async function loadTags(append) {
    let redirected = false;
    state.loading = true;
    state.error = "";
    renderContent();
    try {
      const cursor = append ? state.tagsCursor : "";
      const { data } = await api.tags({ repo: state.repo, pageSize: state.pageSize, cursor });
      const incoming = Array.isArray(data.tags) ? data.tags : [];
      state.tags = append ? uniqueByName([...state.tags, ...incoming]) : incoming;
      state.tagsCursor = data.next || "";
      if (typeof data.deleteEnabled === "boolean") state.config.deleteEnabled = data.deleteEnabled;
      if (!append && incoming.length === 1 && !state.tagsCursor) {
        redirected = true;
        setRouteTag(state.repo, incoming[0].name);
      }
    } catch (error) {
      state.error = error.message || String(error);
      if (!append) state.tags = [];
      state.tagsCursor = "";
    } finally {
      state.loading = false;
      if (!redirected) renderContent();
    }
  }

  async function loadTagDetail() {
    state.loading = true;
    state.error = "";
    state.tagDetail = null;
    renderContent();
    try {
      const { data } = await api.tagDetails({ repo: state.repo, tag: state.tag });
      state.tagDetail = data;
      state.selectedImageIndex = 0;
      if (typeof data.deleteEnabled === "boolean") state.config.deleteEnabled = data.deleteEnabled;
    } catch (error) {
      state.error = error.message || String(error);
    } finally {
      state.loading = false;
      renderContent();
    }
  }

  function renderContent() {
    els.content.setAttribute("aria-busy", state.loading ? "true" : "false");
    if (state.loading && currentItems().length === 0) {
      els.content.innerHTML = `<div class="loading"><div><div class="skeleton"></div>${icon("refresh", "mdi-spin")}<h3>Loading</h3><p>Reading registry metadata.</p></div></div>`;
      return;
    }

    if (state.error) {
      els.content.innerHTML = `<div class="error"><div>${icon("cloud-alert-outline")}<h3>Unable to read the registry</h3><p>${escapeHtml(state.error)}</p></div></div>`;
      return;
    }

    if (state.view === "tag-detail") renderTagDetail();
    else if (state.view === "tags") renderTags();
    else renderRepositories();
  }

  function currentItems() {
    if (state.view === "tag-detail") return state.tagDetail ? [state.tagDetail] : [];
    return state.view === "tags" ? state.tags : state.repositories;
  }

  function filteredRepositories() {
    return state.filter
      ? state.repositories.filter((repo) => repo.name.toLowerCase().includes(state.filter))
      : state.repositories;
  }

  function filteredTags() {
    return state.filter
      ? state.tags.filter((tag) => tag.name.toLowerCase().includes(state.filter))
      : state.tags;
  }

  function renderRepositories() {
    const repos = filteredRepositories();
    if (repos.length === 0) {
      els.content.innerHTML = emptyState(
        "No repositories",
        state.filter ? "No repository matches the current search." : "The catalog is empty or the registry did not return any repository.",
        "database-search-outline"
      );
      return;
    }

    els.content.innerHTML = `
      ${footer(
        `${repos.length} repositor${repos.length > 1 ? "ies" : "y"}`,
        state.catalogCursor,
        "catalog-more",
        "repositories",
        "table-navigation"
      )}
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Repository</th>
              <th>Tags</th>
              <th title="Total image content across distinct tag digests and every platform">Size</th>
              <th>Latest version</th>
              <th>Last updated</th>
            </tr>
          </thead>
          <tbody>${repos.map(renderRepositoryRow).join("")}</tbody>
        </table>
      </div>
    `;
  }

  function renderRepositoryRow(repo) {
    const directTag = repo.tagCount === 1 && !repo.tagsTruncated ? repo.latestTag || "" : "";
    return `
      <tr class="clickable-row" data-repo="${escapeAttr(repo.name)}" data-single-tag="${escapeAttr(directTag)}">
        <td>
          <div class="item-main">
            <span class="name-column-icon" aria-hidden="true">${icon("folder")}</span>
            <span class="item-name" title="${escapeAttr(repo.name)}">${escapeHtml(repo.name)}</span>
          </div>
        </td>
        <td>${renderTagCount(repo.tagCount, repo.tagsTruncated)}</td>
        <td title="Total image content across distinct tag digests and every platform">${formatRepositorySize(repo)}</td>
        <td>${renderLatestTag(repo)}</td>
        <td>${formatDate(repo.updatedAt)}</td>
      </tr>
    `;
  }

  function renderTags() {
    const tags = filteredTags();
    if (tags.length === 0) {
      els.content.innerHTML = emptyState(
        "No tags",
        state.filter ? "No tag matches the current search." : "This repository does not contain visible tags.",
        "tag-multiple-outline"
      );
      return;
    }

    els.content.innerHTML = `
      ${footer(
        `${tags.length} tag${tags.length > 1 ? "s" : ""}`,
        state.tagsCursor,
        "tags-more",
        "tags",
        "table-navigation"
      )}
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Tag</th>
              <th>Digest</th>
              <th>Architectures</th>
              <th>Size</th>
              <th>Created</th>
              <th class="is-right actions-column"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>${tags.map(renderTagRow).join("")}</tbody>
        </table>
      </div>
    `;
  }

  function renderTagRow(tag) {
    const imageRef = `${state.repo}:${tag.name}`;
    return `
      <tr class="clickable-row" data-tag="${escapeAttr(tag.name)}">
        <td>
          <div class="cell-with-action">
            <span class="name-column-icon" aria-hidden="true">${icon("tag-multiple-outline")}</span>
            <button class="link-value" type="button" data-action="open-tag" data-tag="${escapeAttr(tag.name)}" title="Open tag details">
              ${escapeHtml(tag.name)}
            </button>
            <button class="inline-icon" type="button" data-action="copy" data-value="${escapeAttr(imageRef)}" title="Copy image reference" aria-label="Copy image reference">
              ${icon("content-copy")}
            </button>
          </div>
        </td>
        <td>${renderDigest(tag.digest)}</td>
        <td>${renderPlatforms(tag.platforms)}</td>
        <td>${formatBytes(tag.size)}</td>
        <td>${formatDate(tag.createdAt)}</td>
        <td class="is-right">${renderActionsMenu(tag)}</td>
      </tr>
    `;
  }

  function renderDigest(digest) {
    if (!digest) return mutedDash();
    return `
      <div class="cell-with-action digest-cell">
        <span class="code digest" title="${escapeAttr(digest)}">${escapeHtml(shortDigest(digest))}</span>
        <button class="inline-icon" type="button" data-action="copy" data-value="${escapeAttr(digest)}" title="Copy digest" aria-label="Copy digest">
          ${icon("content-copy")}
        </button>
      </div>
    `;
  }

  function renderActionsMenu(tag) {
    const deleteItem = state.config.deleteEnabled
      ? `<button class="bb-menu-item danger" type="button" data-action="delete-tag" data-tag="${escapeAttr(tag.name)}">${icon("delete-outline")}<span>Delete</span></button>`
      : "";
    return `
      <div class="bb-menu">
        <button class="bb-kebab" type="button" data-action="toggle-menu" title="Options" aria-label="Options" aria-haspopup="menu" aria-expanded="false">
          ${icon("dots-vertical")}
        </button>
        <div class="bb-menu-popover" role="menu">
          <div class="bb-menu-list">
            <a class="bb-menu-item" href="${escapeAttr(api.downloadURL(state.repo, tag.name))}" download role="menuitem" title="Download OCI image archive">
              ${icon("download")}<span>Download OCI</span>
            </a>
            ${deleteItem}
          </div>
        </div>
      </div>
    `;
  }

  function renderTagDetail() {
    const detail = state.tagDetail;
    if (!detail) {
      els.content.innerHTML = emptyState("No details", "The registry did not return details for this tag.");
      return;
    }
    const images = Array.isArray(detail.images) ? detail.images : [];
    if (state.selectedImageIndex < 0 || state.selectedImageIndex >= images.length) {
      state.selectedImageIndex = 0;
    }
    const selectedImage = images[state.selectedImageIndex] || null;

    renderTagToolbar(detail);
    els.content.innerHTML = `
      <div class="detail-page">
        ${renderPlatformSelector(images)}
        ${selectedImage ? renderImageDetail(selectedImage, state.selectedImageIndex) : ""}
      </div>
    `;
  }

  function renderTagToolbar(detail) {
    const size = formatBytesText(detail && detail.size) || "0 B";
    els.viewMeta.innerHTML = `
      <span class="toolbar-total-size">
        <span>Size</span>
        <strong>${escapeHtml(size)}</strong>
      </span>
      <span class="toolbar-meta-divider" aria-hidden="true"></span>
      ${renderToolbarDigest(detail && detail.digest)}
    `;
    els.viewMeta.classList.remove("hidden");
    els.tagToolbarActions.innerHTML = `
      <a class="btn small" href="${escapeAttr(api.downloadURL(detail.repository, detail.tag))}" download title="Download OCI image archive">
        ${icon("download")}Download OCI
      </a>
      ${state.config.deleteEnabled ? `
        <button class="btn small danger" type="button" data-action="delete-tag" data-tag="${escapeAttr(detail.tag)}">
          ${icon("delete-outline")}Delete
        </button>
      ` : ""}
    `;
    els.tagToolbarActions.classList.remove("hidden");
  }

  function renderToolbarDigest(digest) {
    if (!digest) return `<span class="toolbar-digest"><span>Digest</span>${mutedDash()}</span>`;
    return `
      <span class="toolbar-digest">
        <span>Digest</span>
        <code>${escapeHtml(digest)}</code>
        <button class="inline-icon" type="button" data-action="copy" data-value="${escapeAttr(digest)}" title="Copy tag digest" aria-label="Copy tag digest">
          ${icon("content-copy")}
        </button>
      </span>
    `;
  }

  function renderPlatformSelector(images) {
    if (!Array.isArray(images) || images.length === 0) return "";
    return `
      <section class="platform-selector" aria-label="Image platforms">
        <div class="platform-buttons" role="tablist" aria-label="Available image architectures">
          ${images.map((image, index) => {
            const created = formatDateText(image.createdAt) || "Date unknown";
            const author = String(image.author || "").trim() || "Unknown author";
            return `
              <button
                class="platform-button ${index === state.selectedImageIndex ? "is-active" : ""}"
                type="button"
                role="tab"
                aria-selected="${index === state.selectedImageIndex ? "true" : "false"}"
                aria-controls="selectedPlatformDetail"
                data-action="select-platform"
                data-image-index="${index}">
                <strong class="platform-button-platform">${escapeHtml(image.platform || `Image ${index + 1}`)}</strong>
                <span class="platform-button-size">${escapeHtml(formatBytesText(image.size) || "0 B")}</span>
                <small class="platform-button-author">${escapeHtml(author)}</small>
                <time class="platform-button-date"${image.createdAt ? ` datetime="${escapeAttr(image.createdAt)}"` : ""}>${escapeHtml(created)}</time>
              </button>
            `;
          }).join("")}
        </div>
      </section>
    `;
  }

  function renderImageDetail(image, index) {
    const title = image.platform || `Image ${index + 1}`;
    const detail = state.tagDetail || {};
    const dockerDownload = detail.repository && detail.tag && image.digest
      ? `
        <a
          class="btn small docker-download"
          href="${escapeAttr(api.dockerDownloadURL(detail.repository, detail.tag, image.digest))}"
          download
          title="Download a Docker image archive for ${escapeAttr(title)}; load it with docker image load">
          ${icon("download")}Download
        </a>
      `
      : "";
    return `
      <section id="selectedPlatformDetail" class="detail-card image-detail-card" role="tabpanel">
        <div class="detail-card-head">
          <div class="image-identity">
            <div class="image-title-row">
              <h3>${escapeHtml(title)}</h3>
              ${image.mediaType ? `<span class="badge">${escapeHtml(shortMediaType(image.mediaType))}</span>` : ""}
            </div>
            <div class="digest-stack">
              ${renderDigestRow("Digest", image.digest, "Copy image digest")}
              ${renderDigestRow("Config digest", image.configDigest, "Copy config digest")}
            </div>
          </div>
          <div class="image-detail-actions">
            ${dockerDownload}
          </div>
        </div>

        <div class="runtime-label-grid">
          <section class="detail-subsection">
            <h4>Runtime</h4>
            ${renderKeyValueRows([
              ["User", image.user, "user"],
              ["Working dir", image.workingDir, "path"],
              ["Entrypoint", image.entrypoint, "command"],
              ["Cmd", image.cmd, "command"]
            ])}
          </section>
          <section class="detail-subsection">
            <h4>Labels</h4>
            ${renderKeyValueTable(image.labels, "No labels")}
          </section>
        </div>

        <div class="config-source-grid">
          <section class="detail-subsection">
            <h4>Build args</h4>
            ${renderNumberedValues(image.args, "No build args found in image history")}
          </section>
          <section class="detail-subsection">
            <h4>Environment</h4>
            ${renderNumberedValues(image.env, "No environment values")}
          </section>
          <section class="detail-subsection exposed-subsection">
            <h4>Exposed</h4>
            ${renderExposedPorts(image.exposedPorts)}
          </section>
        </div>

        <div class="section-title-row history-title-row">
          <h4>Dockerfile</h4>
          <button class="btn small copy-dockerfile-btn" type="button" data-action="copy-dockerfile">${icon("content-copy")}Copy Dockerfile</button>
        </div>
        ${renderDockerHistoryEditor(image.instructions)}
      </section>
    `;
  }

  function renderDigestRow(label, digest, copyLabel) {
    if (!digest) {
      return `<div class="toolbar-digest digest-row"><span>${escapeHtml(label)}</span>${mutedDash()}</div>`;
    }
    return `
      <div class="toolbar-digest digest-row">
        <span>${escapeHtml(label)}</span>
        <code>${escapeHtml(digest)}</code>
        <button class="inline-icon" type="button" data-action="copy" data-value="${escapeAttr(digest)}" title="${escapeAttr(copyLabel)}" aria-label="${escapeAttr(copyLabel)}">
          ${icon("content-copy")}
        </button>
      </div>
    `;
  }

  function renderKeyValueRows(rows) {
    return `
      <div class="kv-table runtime-kv-table">
        ${rows.map(([key, value, hint]) => `
          <div class="kv-key">${escapeHtml(key)}</div>
          <div class="kv-value">${renderTypedValue(value, hint)}</div>
        `).join("")}
      </div>
    `;
  }

  function renderNumberedValues(values, empty) {
    const lines = Array.isArray(values) ? values.filter(Boolean).map(String) : [];
    if (lines.length === 0) return `<div class="empty-inline">${escapeHtml(empty)}</div>`;
    return `
      <div class="config-source code-viewer" role="region">
        <div class="config-code-lines">
          ${lines.map((line, index) => `
            <div class="config-code-row">
              <span class="config-line-number" aria-hidden="true">${index + 1}</span>
              <code class="config-line-code">${highlightConfigAssignment(line)}</code>
            </div>
          `).join("")}
        </div>
      </div>
    `;
  }

  function renderExposedPorts(values) {
    const lines = Array.isArray(values) ? values.filter(Boolean).map(String) : [];
    if (lines.length === 0) return `<div class="empty-inline exposed-empty">—</div>`;
    return `
      <div class="config-source exposed-source code-viewer" role="region">
        <pre class="config-code"><code>${lines.map(highlightExposedPort).join("\n")}</code></pre>
      </div>
    `;
  }

  function renderDockerHistoryEditor(instructions) {
    const records = buildDockerfileRecords(instructions);
    if (records.length === 0) return `<div class="empty-inline">No Dockerfile history</div>`;
    let lineNumber = 1;
    const source = records.map((record) => {
      const separator = record.blankBefore ? `
        <div class="docker-source-block docker-history-separator">
          <div class="docker-source-line">
            <span class="docker-source-ln" aria-hidden="true">${lineNumber++}</span>
            <code class="docker-source-code"></code>
          </div>
        </div>
      ` : "";
      const code = record.lines.map((line) => `
        <div class="docker-source-line">
          <span class="docker-source-ln" aria-hidden="true">${lineNumber++}</span>
          <code class="docker-source-code">${highlightDockerInstruction(line)}</code>
        </div>
      `).join("");
      return `${separator}<div class="docker-source-block">${code}</div>`;
    }).join("");
    const metadata = records.map((record) => {
      const separator = record.blankBefore
        ? '<div class="history-meta-slot history-meta-empty" aria-hidden="true"></div>'
        : "";
      const lineCount = Math.max(1, record.lines.length);
      return `${separator}<div class="history-meta-slot" style="--history-row-lines: ${lineCount}">${renderInstructionMetadata(record.item)}</div>`;
    }).join("");
    return `
      <div class="docker-history" role="region" aria-label="Reconstructed Dockerfile and image history">
        <div class="history-meta-header" aria-hidden="true">
          <span class="history-meta-header-size">Size</span>
          <span class="history-meta-header-change"></span>
          <span class="history-meta-header-date">Date</span>
        </div>
        <div class="docker-history-body">
          <div class="docker-source-pane">
            <div class="docker-source-content">
              ${source}
            </div>
          </div>
          <div class="docker-history-meta-pane">
            ${metadata}
          </div>
        </div>
      </div>
    `;
  }

  function buildDockerfileRecords(instructions) {
    const items = (Array.isArray(instructions) ? instructions : [])
      .filter(Boolean);
    const records = [];
    let previousGroup = "";
    let previousKeyword = "";

    items.forEach((item) => {
      const recorded = String(item.instruction || "").trim();
      const instruction = recorded || (item.layerDigest
        ? `# OCI layer ${Number(item.layerIndex || 0)} instruction unavailable`
        : "# OCI config history entry without an instruction");
      const keyword = dockerInstructionKeyword(instruction);
      const group = dockerInstructionGroup(keyword);
      const blankBefore = records.length > 0 && (
        previousKeyword === "FROM" ||
        keyword === "FROM" ||
        (previousGroup && group && previousGroup !== group)
      );
      records.push({
        item,
        blankBefore,
        lines: wrapDockerInstruction(instruction)
      });
      previousGroup = group;
      previousKeyword = keyword;
    });
    return records;
  }

  function buildDockerfileLines(instructions) {
    const lines = [];
    buildDockerfileRecords(instructions).forEach((record) => {
      if (record.blankBefore && lines[lines.length - 1] !== "") lines.push("");
      lines.push(...record.lines);
    });
    return lines;
  }

  function dockerInstructionKeyword(instruction) {
    const match = String(instruction || "").match(/^([A-Z][A-Z0-9_-]*)(?:\s|$)/i);
    return match ? match[1].toUpperCase() : "";
  }

  function dockerInstructionGroup(keyword) {
    if (keyword === "ARG") return "arg";
    if (keyword === "FROM") return "base";
    if (["ADD", "COPY", "RUN"].includes(keyword)) return "filesystem";
    if (["CMD", "ENTRYPOINT", "HEALTHCHECK"].includes(keyword)) return "runtime";
    return "config";
  }

  function wrapDockerInstruction(instruction) {
    const source = String(instruction || "").trim();
    if (source.startsWith("HEALTHCHECK ")) {
      const commandIndex = source.indexOf(" CMD ");
      if (commandIndex < 0) return [source];
      const options = source.slice("HEALTHCHECK ".length, commandIndex).trim().split(/\s+/).filter(Boolean);
      if (options.length === 0) return [source];
      const indent = "            ";
      const command = source.slice(commandIndex + 1);
      return [
        `HEALTHCHECK ${options[0]} \\`,
        ...options.slice(1).map((option) => `${indent}${option} \\`),
        `${indent}${command}`
      ];
    }
    if (!source.startsWith("RUN ")) return [source];
    return wrapShellRunInstruction(source);
  }

  function wrapShellRunInstruction(instruction) {
    const body = instruction.slice("RUN ".length)
      .replace(/\\\r?\n[ \t]*/g, " ")
      .trim();
    const looksFlattened = /[\t\r\n]| {2,}/.test(body);
    if (!looksFlattened && instruction.length <= DOCKERFILE_WRAP_COLUMN) return [instruction];

    const statements = coalesceShellCaseBranches(
      splitShellStatements(body).flatMap(splitFlattenedCaseHeader)
    );
    if (statements.length < 2) {
      return [`RUN ${statements[0] || body}`];
    }

    let caseDepth = 0;
    return statements.map((statement, index) => {
      const closesCase = /^esac(?:\s|;|$)/.test(statement);
      if (closesCase) caseDepth = Math.max(0, caseDepth - 1);

      const indent = index === 0
        ? ""
        : " ".repeat(4 + (caseDepth * 4));
      const prefix = index === 0 ? "RUN " : indent;
      const continuation = index < statements.length - 1 ? " \\" : "";

      if (/^case\b.*\bin$/.test(statement)) caseDepth += 1;
      return `${prefix}${statement}${continuation}`;
    });
  }

  function splitShellStatements(value) {
    const statements = [];
    let current = "";
    let quote = "";

    const push = () => {
      const normalized = current.trim();
      if (normalized) statements.push(normalized);
      current = "";
    };

    for (let index = 0; index < value.length; index += 1) {
      const character = value[index];
      const next = value[index + 1] || "";

      if (quote) {
        current += character;
        if (character === "\\" && quote !== "'" && next) {
          current += next;
          index += 1;
        } else if (character === quote) {
          quote = "";
        }
        continue;
      }

      if (character === "'" || character === '"' || character === "`") {
        quote = character;
        current += character;
        continue;
      }
      if (character === "\\" && next) {
        current += character + next;
        index += 1;
        continue;
      }
      if (character === ";") {
        if (next === ";") {
          current = `${current.trimEnd()} ;;`;
          index += 1;
        } else {
          current = current.trimEnd() + character;
        }
        push();
        continue;
      }
      if ((character === "&" && next === "&") || (character === "|" && next === "|")) {
        current = current.trimEnd() + character + next;
        index += 1;
        push();
        continue;
      }
      if (/\s/.test(character)) {
        if (current && !current.endsWith(" ")) current += " ";
        continue;
      }
      current += character;
    }
    push();
    return statements;
  }

  function splitFlattenedCaseHeader(statement) {
    const match = String(statement || "").match(/^(case\b.*?\bin\b)\s+(\S+\).*)$/);
    return match ? [match[1], match[2]] : [statement];
  }

  function coalesceShellCaseBranches(statements) {
    const result = [];
    let caseDepth = 0;
    let branch = "";

    const flushBranch = () => {
      if (branch) result.push(branch);
      branch = "";
    };

    statements.forEach((statement) => {
      if (/^case\b.*\bin$/.test(statement)) {
        flushBranch();
        result.push(statement);
        caseDepth += 1;
        return;
      }
      if (caseDepth > 0 && /^esac(?:\s|;|$)/.test(statement)) {
        flushBranch();
        result.push(statement);
        caseDepth = Math.max(0, caseDepth - 1);
        return;
      }
      if (caseDepth > 0 && isShellCaseBranch(statement)) {
        flushBranch();
        branch = statement;
        if (/;;$/.test(branch)) flushBranch();
        return;
      }
      if (caseDepth > 0 && branch) {
        branch += ` ${statement}`;
        if (/;;$/.test(branch)) flushBranch();
        return;
      }
      result.push(statement);
    });
    flushBranch();
    return result;
  }

  function isShellCaseBranch(statement) {
    return /^(?:\*|[^\s()]+(?:\|[^\s()]+)*)\)(?:\s|$)/.test(String(statement || ""));
  }

  function renderInstructionMetadata(item) {
    const keyword = dockerInstructionKeyword(item && item.instruction);
    const isLayer = Boolean(item && item.layerDigest);
    const isStage = keyword === "FROM";
    const source = isStage ? "Stage" : isLayer ? `Layer ${Number(item.layerIndex || 0)}` : "Config";
    const totalSize = formatHistoryBytes(item && item.cumulativeSize);
    const total = totalSize.text;
    const changeValue = isLayer ? Number(item.layerSize || 0) : 0;
    const change = formatSizeChange(changeValue);
    const changeSize = change ? formatHistoryBytes(Math.abs(changeValue)) : null;
    const changeClass = changeValue > 0 ? "is-positive" : changeValue < 0 ? "is-negative" : "is-zero";
    const changeDescription = change || "no filesystem size change";
    const created = formatDateText(item && item.createdAt) || "—";
    const title = isStage
      ? "FROM creates a build stage but no filesystem layer. Inherited base layers are listed separately with their registry descriptor sizes."
      : isLayer
        ? "Exact compressed blob size from the image manifest."
        : "Runtime/config metadata is stored in the shared OCI config blob and adds no filesystem layer.";
    return `
      <div
        class="history-meta"
        title="${escapeAttr(`${source} · total ${total} · ${changeDescription} · ${created}. ${title}`)}"
        aria-label="${escapeAttr(`${source}, total size ${total}, ${changeDescription}, date ${created}`)}">
        <span class="history-meta-total">${renderHistorySize(totalSize)}</span>
        <span class="history-meta-change ${changeClass}"${change ? "" : ' aria-label="No size change"'}>${changeSize ? renderHistorySize(changeSize, changeValue < 0 ? "−" : "+") : ""}</span>
        <time class="history-meta-date"${item && item.createdAt ? ` datetime="${escapeAttr(item.createdAt)}"` : ""}>${escapeHtml(created)}</time>
      </div>
    `;
  }

  function formatSizeChange(value) {
    const size = Number(value || 0);
    if (!Number.isFinite(size) || size === 0) return "";
    const magnitude = formatHistoryBytes(Math.abs(size)).text;
    return `${size < 0 ? "-" : "+"}${magnitude}`;
  }

  function formatHistoryBytes(value) {
    const size = Number(value || 0);
    if (!Number.isFinite(size) || size <= 0) {
      return { amount: "0", unit: "B", text: "0 B" };
    }
    const units = ["B", "KB", "MB", "GB", "TB"];
    let unit = 0;
    let amount = size;
    while (amount >= 1024 && unit < units.length - 1) {
      amount /= 1024;
      unit += 1;
    }
    const amountText = amount.toFixed(1);
    return {
      amount: amountText,
      unit: units[unit],
      text: `${amountText} ${units[unit]}`
    };
  }

  function renderHistorySize(size, sign = "") {
    return `
      <span class="history-size-number">${escapeHtml(`${sign}${size.amount}`)}</span>
      <span class="history-size-unit">${escapeHtml(size.unit)}</span>
    `;
  }

  function renderKeyValueTable(values, empty) {
    if (!values || typeof values !== "object" || Object.keys(values).length === 0) return `<div class="empty-inline">${escapeHtml(empty)}</div>`;
    return `
      <div class="kv-table">
        ${Object.keys(values).sort().map((key) => `
          <div class="kv-key">${escapeHtml(key)}</div>
          <div class="kv-value">${renderTypedValue(values[key], "label")}</div>
        `).join("")}
      </div>
    `;
  }

  function renderTypedValue(value, hint = "") {
    if (value === undefined || value === null || value === "") return mutedDash();
    if (Array.isArray(value) && value.length === 0) return mutedDash();
    if (Array.isArray(value) || (typeof value === "object" && value !== null)) {
      return highlightJSONValue(value);
    }

    const text = String(value);
    const normalized = text.trim();
    if (!normalized) return mutedDash();
    if (hint === "user") return highlightUserValue(normalized);
    if (hint === "path") return `<span class="typed-path">${escapeHtml(text)}</span>`;
    if (hint === "command" && /^[\[{]/.test(normalized)) {
      try {
        return highlightJSONValue(JSON.parse(normalized));
      } catch (_) {
        return `<span class="typed-string">${escapeHtml(text)}</span>`;
      }
    }
    if (/^(?:true|false)$/i.test(normalized)) {
      return `<span class="typed-boolean">${escapeHtml(text)}</span>`;
    }
    if (/^null$/i.test(normalized)) {
      return `<span class="typed-null">${escapeHtml(text)}</span>`;
    }
    if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(normalized)) {
      return `<span class="typed-number">${escapeHtml(text)}</span>`;
    }
    if (/^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(normalized)) {
      return `<span class="typed-url">${escapeHtml(text)}</span>`;
    }
    if (/^(?:sha256|sha512):[a-f0-9]+$/i.test(normalized)) {
      return `<span class="typed-digest">${escapeHtml(text)}</span>`;
    }
    if (/^\d{4}-\d{2}-\d{2}(?:[T ][0-9:.+-]+Z?)?$/.test(normalized)) {
      return `<span class="typed-date">${escapeHtml(text)}</span>`;
    }
    return `<span class="typed-string">${escapeHtml(text)}</span>`;
  }

  function highlightUserValue(value) {
    return String(value).split(/(:)/).map((part) => {
      if (part === ":") return '<span class="typed-punctuation">:</span>';
      if (/^\d+$/.test(part)) return `<span class="typed-number">${escapeHtml(part)}</span>`;
      return `<span class="typed-string">${escapeHtml(part)}</span>`;
    }).join("");
  }

  function highlightJSONValue(value) {
    const source = JSON.stringify(value);
    if (source === undefined) return mutedDash();
    const tokenPattern = /"(?:\\.|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|\b(?:true|false|null)\b|[{}\[\],:]/g;
    let output = "";
    let cursor = 0;
    for (const match of source.matchAll(tokenPattern)) {
      output += escapeHtml(source.slice(cursor, match.index));
      const token = match[0];
      let className = "typed-punctuation";
      if (token.startsWith('"')) className = "typed-string";
      else if (/^(?:true|false)$/.test(token)) className = "typed-boolean";
      else if (token === "null") className = "typed-null";
      else if (/^-?\d/.test(token)) className = "typed-number";
      output += `<span class="${className}">${escapeHtml(token)}</span>`;
      cursor = match.index + token.length;
    }
    output += escapeHtml(source.slice(cursor));
    return output;
  }

  function footer(label, cursor, action, unit = "items", extraClass = "") {
    return `
      <div class="footer-row ${escapeAttr(extraClass)}">
        <div class="footer-left">
          <label class="footer-size">
            <select data-role="page-size" autocomplete="off" aria-label="${escapeAttr(`${unit} per page`)}">
              ${PAGE_SIZES.map((size) => `<option value="${size}" ${state.pageSize === size ? "selected" : ""}>${size}</option>`).join("")}
            </select>
            <span>${escapeHtml(unit)} per page</span>
          </label>
        </div>
        <div class="footer-right">
          <span class="footer-count">${escapeHtml(label)}${state.loading ? " · loading..." : ""}</span>
          ${cursor ? `<button class="btn small" type="button" data-action="${action}" ${state.loading ? "disabled" : ""}>Load more</button>` : ""}
        </div>
      </div>
    `;
  }

  function emptyState(title, message, iconName = "database-search-outline") {
    return `<div class="empty"><div>${icon(iconName)}<h3>${escapeHtml(title)}</h3><p>${escapeHtml(message)}</p></div></div>`;
  }

  async function onDocumentClick(event) {
    const actionEl = event.target.closest("[data-action]");
    if (actionEl) {
      const action = actionEl.dataset.action;
      if (action !== "catalog-more" && action !== "tags-more") {
        event.preventDefault();
        event.stopPropagation();
      }

      if (action === "toggle-menu") {
        toggleMenu(actionEl.closest(".bb-menu"));
        return;
      }
      if (action === "open-repo") setRouteRepository(actionEl.dataset.repo || "");
      if (action === "open-tag") setRouteTag(actionEl.dataset.repo || state.repo, actionEl.dataset.tag || "");
      if (action === "select-platform") {
        const index = Number(actionEl.dataset.imageIndex);
        if (Number.isInteger(index) && index >= 0) {
          state.selectedImageIndex = index;
          renderTagDetail();
          requestAnimationFrame(() => {
            const active = els.content.querySelector(`[data-action="select-platform"][data-image-index="${index}"]`);
            if (active) active.focus({ preventScroll: true });
          });
        }
      }
      if (action === "copy") copyText(actionEl.dataset.value || "");
      if (action === "copy-dockerfile") {
        const images = state.tagDetail && Array.isArray(state.tagDetail.images) ? state.tagDetail.images : [];
        const image = images[state.selectedImageIndex];
        await copyText(buildDockerfileLines(image ? image.instructions : []).join("\n"));
      }
      if (action === "catalog-more") loadCatalog(true);
      if (action === "tags-more") loadTags(true);
      if (action === "delete-tag") deleteTag(actionEl.dataset.tag || "");
      closeMenus();
      return;
    }

    const repoRow = event.target.closest("tr[data-repo]");
    if (repoRow) {
      const repo = repoRow.dataset.repo || "";
      const singleTag = repoRow.dataset.singleTag || "";
      if (singleTag) setRouteTag(repo, singleTag);
      else setRouteRepository(repo);
      return;
    }

    const tagRow = event.target.closest("tr[data-tag]");
    if (tagRow && state.view === "tags") setRouteTag(state.repo, tagRow.dataset.tag || "");
  }

  function onDocumentChange(event) {
    const select = event.target.closest('[data-role="page-size"]');
    if (!select) return;
    state.pageSize = Number(select.value || 25);
    normalizePageSize();
    localStorage.setItem("registry-ui-page-size", String(state.pageSize));
    reloadCurrent();
  }

  async function deleteTag(tag) {
    if (!state.config.deleteEnabled || !tag) return;
    const ok = await confirmAction(`${state.repo}:${tag}`);
    if (!ok) return;

    try {
      await api.deleteTag({ repo: state.repo, tag });
      state.tags = state.tags.filter((item) => item.name !== tag);
      if (state.view === "tag-detail") setRouteRepository(state.repo);
      toast("Tag deleted", "success");
    } catch (error) {
      toast(error.message || String(error), "error");
    } finally {
      renderContent();
    }
  }

  let confirmResolver = null;

  function confirmAction(reference) {
    if (confirmResolver) closeConfirm(false);
    els.confirmReference.textContent = reference;
    els.confirmOverlay.classList.remove("hidden");
    document.documentElement.classList.add("bb-no-scroll");
    document.body.classList.add("bb-no-scroll");
    requestAnimationFrame(() => {
      els.confirmOverlay.classList.add("is-open");
      els.confirmDelete.focus();
    });
    return new Promise((resolve) => {
      confirmResolver = resolve;
    });
  }

  function closeConfirm(result) {
    if (!confirmResolver) return;
    const resolve = confirmResolver;
    confirmResolver = null;
    els.confirmOverlay.classList.remove("is-open");
    document.documentElement.classList.remove("bb-no-scroll");
    document.body.classList.remove("bb-no-scroll");
    window.setTimeout(() => els.confirmOverlay.classList.add("hidden"), 130);
    resolve(Boolean(result));
  }

  async function copyText(value) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      toast("Copied", "success");
    } catch (_) {
      const input = document.createElement("textarea");
      input.value = value;
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      input.remove();
      toast("Copied", "success");
    }
  }

  function toggleMenu(menu) {
    if (!menu) return;
    const wasOpen = menu.classList.contains("is-open");
    closeMenus();
    if (!wasOpen) {
      menu.classList.add("is-open");
      const trigger = menu.querySelector(".bb-kebab");
      if (trigger) trigger.setAttribute("aria-expanded", "true");
      requestAnimationFrame(() => positionMenu(menu));
    }
  }

  function positionMenu(menu) {
    const trigger = menu.querySelector(".bb-kebab");
    const popover = menu.querySelector(".bb-menu-popover");
    if (!trigger || !popover) return;

    popover.style.display = "block";
    popover.style.visibility = "hidden";

    const scale = interfaceScale();
    const rawRect = trigger.getBoundingClientRect();
    const rect = {
      left: rawRect.left / scale,
      right: rawRect.right / scale,
      top: rawRect.top / scale,
      bottom: rawRect.bottom / scale
    };
    const viewport = {
      width: window.innerWidth / scale,
      height: window.innerHeight / scale
    };
    const width = popover.offsetWidth || 220;
    const height = popover.offsetHeight || 160;
    let left = Math.max(8, rect.right - width);
    let top = rect.bottom + 8;

    left = Math.min(left, viewport.width - width - 8);
    if (top + height > viewport.height - 8) top = Math.max(8, rect.top - height - 8);

    popover.style.position = "fixed";
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
    popover.style.visibility = "visible";
  }

  function interfaceScale() {
    const configured = Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue("--browser-ui-scale-active")
    );
    return Number.isFinite(configured) && configured > 0 ? configured : 1;
  }

  function closeMenus() {
    document.querySelectorAll(".bb-menu.is-open").forEach((menu) => {
      menu.classList.remove("is-open");
      const trigger = menu.querySelector(".bb-kebab");
      const popover = menu.querySelector(".bb-menu-popover");
      if (trigger) trigger.setAttribute("aria-expanded", "false");
      if (popover) {
        popover.style.display = "";
        popover.style.visibility = "";
        popover.style.left = "";
        popover.style.top = "";
        popover.style.position = "";
      }
    });
  }

  let toastTimer = 0;
  function toast(message, status = "success") {
    window.clearTimeout(toastTimer);
    els.toastMessage.textContent = message;
    els.toast.classList.toggle("is-error", status === "error");
    els.toastIcon.className = `mdi ${status === "error" ? "mdi-alert-circle-outline" : "mdi-check-circle-outline"} bb-toast-icon`;
    els.toast.classList.remove("hidden");
    requestAnimationFrame(() => els.toast.classList.add("is-show"));
    toastTimer = window.setTimeout(() => {
      els.toast.classList.remove("is-show");
      window.setTimeout(() => els.toast.classList.add("hidden"), 190);
    }, 2600);
  }

  function renderTagCount(count, truncated) {
    if (typeof count !== "number" || count < 0) return mutedDash();
    return `${truncated ? "≥ " : ""}${count}`;
  }

  function formatRepositorySize(repo) {
    const text = formatBytesText(repo && repo.size);
    if (!text) return mutedDash();
    return `${repo.sizeTruncated ? "≥ " : ""}${escapeHtml(text)}`;
  }

  function renderLatestTag(repo) {
    if (!repo || !repo.latestTag) return mutedDash();
    return `
      <button class="latest-tag" type="button" data-action="open-tag" data-repo="${escapeAttr(repo.name)}" data-tag="${escapeAttr(repo.latestTag)}" title="Open ${escapeAttr(repo.name)}:${escapeAttr(repo.latestTag)}">
        ${escapeHtml(repo.latestTag)}
      </button>
    `;
  }

  function renderPlatforms(platforms, extraClass = "") {
    const list = Array.isArray(platforms) ? platforms.filter(Boolean) : [];
    if (list.length === 0) return mutedDash();
    return `<div class="platforms ${escapeAttr(extraClass)}">${list.map((item) => `<span class="badge">${escapeHtml(item)}</span>`).join("")}</div>`;
  }

  function mutedDash() { return `<span class="muted">—</span>`; }

  function uniqueByName(items) {
    const seen = new Set();
    return items.filter((item) => {
      const key = item && item.name;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function shortDigest(digest) {
    if (!digest || digest.length < 24) return digest || "—";
    const [algo, value] = digest.split(":");
    if (!value) return `${digest.slice(0, 20)}…`;
    return `${algo}:${value.slice(0, 18)}…`;
  }

  function shortMediaType(value) {
    return String(value)
      .split(";")[0]
      .replace("application/vnd.", "")
      .replace("docker.distribution.", "docker.")
      .replace("oci.image.", "oci.");
  }

  function formatDate(value) {
    const text = formatDateText(value);
    if (!text) return mutedDash();
    const date = new Date(value);
    return `<time class="table-date" datetime="${escapeAttr(date.toISOString())}">${escapeHtml(text)}</time>`;
  }

  function formatDateText(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const pad = (number) => String(number).padStart(2, "0");
    return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}h${pad(date.getMinutes())}`;
  }

  function formatBytes(value) {
    const text = formatBytesText(value);
    return text ? escapeHtml(text) : mutedDash();
  }

  function formatBytesText(value) {
    const size = Number(value || 0);
    if (!Number.isFinite(size) || size <= 0) return "";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let unit = 0;
    let amount = size;
    while (amount >= 1024 && unit < units.length - 1) {
      amount /= 1024;
      unit += 1;
    }
    return `${amount.toFixed(1)} ${units[unit]}`;
  }

  function highlightConfigAssignment(value) {
    const source = String(value || "");
    const separator = source.indexOf("=");
    if (separator < 0) return `<span class="config-key">${escapeHtml(source)}</span>`;
    return [
      `<span class="config-key">${escapeHtml(source.slice(0, separator))}</span>`,
      '<span class="config-operator">=</span>',
      `<span class="config-value">${escapeHtml(source.slice(separator + 1))}</span>`
    ].join("");
  }

  function highlightExposedPort(value) {
    const source = String(value || "");
    const separator = source.indexOf("/");
    if (separator < 0) return `<span class="config-number">${escapeHtml(source)}</span>`;
    return [
      `<span class="config-number">${escapeHtml(source.slice(0, separator))}</span>`,
      '<span class="config-operator">/</span>',
      `<span class="config-value">${escapeHtml(source.slice(separator + 1))}</span>`
    ].join("");
  }

  function highlightDockerInstruction(value) {
    const strings = [];
    const source = String(value || "").replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, (literal) => {
      const index = strings.push(literal) - 1;
      return `\uE000${index}\uE001`;
    });
    const escaped = escapeHtml(source);
    return escaped
      .replace(/^(\s*)([A-Z][A-Z0-9_-]*)(\s|$)/, '$1<span class="docker-keyword">$2</span>$3')
      .replace(/(\s--[a-zA-Z0-9][^\s=]*)(=|\s|$)/g, '<span class="docker-flag">$1</span>$2')
      .replace(/^(\s*)(#.*)$/g, '$1<span class="docker-comment">$2</span>')
      .replace(/(\s#.*)$/g, '<span class="docker-comment">$1</span>')
      .replace(/\uE000(\d+)\uE001/g, (_, index) => `<span class="docker-string">${escapeHtml(strings[Number(index)] || "")}</span>`);
  }

  function icon(name, extraClass = "") {
    return `<i class="mdi mdi-${escapeAttr(name)} ${escapeAttr(extraClass)}" aria-hidden="true"></i>`;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }
})();
