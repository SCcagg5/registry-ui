(() => {
  "use strict";

  const api = window.RegistryUIApi;
  const $ = (selector) => document.querySelector(selector);

  const PAGE_SIZES = [25, 50, 100];

  const state = {
    config: null,
    view: "repositories",
    repo: "",
    tag: "",
    repositories: [],
    tags: [],
    tagDetail: null,
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
    els.backBtn = $("#backBtn");
    els.viewTitle = $("#viewTitle");
    els.searchInput = $("#searchInput");
    els.searchField = els.searchInput ? els.searchInput.closest(".field") : null;
    els.notice = $("#notice");
    els.content = $("#content");
    els.toast = $("#toast");
  }

  function bindEvents() {
    els.backBtn.addEventListener("click", goBack);
    els.searchInput.addEventListener("input", () => {
      state.filter = els.searchInput.value.trim().toLowerCase();
      renderContent();
    });
    document.addEventListener("click", onDocumentClick);
    document.addEventListener("change", onDocumentChange);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeMenus();
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
    if (state.view === "tag-detail") setRouteRepository(state.repo);
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

    document.title = isTagDetail
      ? `${state.repo}:${state.tag} · Registry UI`
      : isTags
        ? `${state.repo} · Registry UI`
        : "Registry UI";

    els.versionBadge.textContent = cfg.version || "dev";
    els.backBtn.classList.toggle("is-placeholder", isRepositories);
    els.backBtn.disabled = isRepositories;
    els.viewTitle.textContent = isTagDetail ? `${state.repo}:${state.tag}` : isTags ? state.repo : "Repositories";
    els.searchField.classList.toggle("hidden", isTagDetail);
    els.searchInput.placeholder = isTags ? "Filter tags" : "Image or namespace";
  }

  function renderNotice() {
    const cfg = state.config || {};
    const needsConfig = !cfg.proxyEnabled;
    els.notice.className = needsConfig ? "notice warn" : "notice hidden";
    els.notice.textContent = needsConfig
      ? "No registry proxy is configured. Set REGISTRY_PROXY_PASS_URL or REGISTRY_URL."
      : "";
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
    } catch (error) {
      state.error = error.message || String(error);
      if (!append) state.tags = [];
      state.tagsCursor = "";
    } finally {
      state.loading = false;
      renderContent();
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
      if (typeof data.deleteEnabled === "boolean") state.config.deleteEnabled = data.deleteEnabled;
    } catch (error) {
      state.error = error.message || String(error);
    } finally {
      state.loading = false;
      renderContent();
    }
  }

  function renderContent() {
    if (state.loading && currentItems().length === 0) {
      els.content.innerHTML = `<div class="loading"><div><div class="skeleton"></div><h3>Loading</h3><p>Reading registry metadata.</p></div></div>`;
      return;
    }

    if (state.error) {
      els.content.innerHTML = `<div class="error"><div><h3>Unable to read the registry</h3><p>${escapeHtml(state.error)}</p></div></div>`;
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
        state.filter ? "No repository matches the current search." : "The catalog is empty or the registry did not return any repository."
      );
      return;
    }

    els.content.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Repository</th>
              <th>Tags</th>
              <th>Size</th>
              <th>Latest version</th>
              <th>Last updated</th>
            </tr>
          </thead>
          <tbody>${repos.map(renderRepositoryRow).join("")}</tbody>
        </table>
      </div>
      ${footer(`${repos.length} repositor${repos.length > 1 ? "ies" : "y"}`, state.catalogCursor, "catalog-more")}
    `;
  }

  function renderRepositoryRow(repo) {
    return `
      <tr class="clickable-row" data-repo="${escapeAttr(repo.name)}">
        <td>
          <div class="item-main">
            <span class="item-name" title="${escapeAttr(repo.name)}">${escapeHtml(repo.name)}</span>
          </div>
        </td>
        <td>${renderTagCount(repo.tagCount, repo.tagsTruncated)}</td>
        <td>${formatRepositorySize(repo)}</td>
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
        state.filter ? "No tag matches the current search." : "This repository does not contain visible tags."
      );
      return;
    }

    els.content.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Tag</th>
              <th>Digest</th>
              <th>Architectures</th>
              <th>Size</th>
              <th>Created</th>
              <th class="is-right actions-column">Actions</th>
            </tr>
          </thead>
          <tbody>${tags.map(renderTagRow).join("")}</tbody>
        </table>
      </div>
      ${footer(`${tags.length} tag${tags.length > 1 ? "s" : ""}`, state.tagsCursor, "tags-more")}
    `;
  }

  function renderTagRow(tag) {
    const imageRef = `${state.repo}:${tag.name}`;
    return `
      <tr class="clickable-row" data-tag="${escapeAttr(tag.name)}">
        <td>
          <div class="cell-with-action">
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
            <a class="bb-menu-item" href="${escapeAttr(api.downloadURL(state.repo, tag.name))}" download role="menuitem">
              ${icon("download")}<span>Download</span>
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

    els.content.innerHTML = `
      <div class="detail-page">
        <section class="detail-card summary-card">
          <div class="detail-card-head">
            <div>
              <h3>Image summary</h3>
              <span class="muted">${escapeHtml(detail.repository)}:${escapeHtml(detail.tag)}</span>
            </div>
            <div class="actions">
              <a class="btn small" href="${escapeAttr(api.downloadURL(detail.repository, detail.tag))}" download>${icon("download")}Download</a>
              ${state.config.deleteEnabled ? `<button class="btn small danger" type="button" data-action="delete-tag" data-tag="${escapeAttr(detail.tag)}">${icon("delete-outline")}Delete</button>` : ""}
            </div>
          </div>
          <div class="summary-grid">
            ${summaryItem("Repository", detail.repository)}
            ${summaryItem("Tag", detail.tag)}
            ${summaryItem("Digest", renderCopyValue(detail.digest, detail.digest, shortDigest(detail.digest)))}
            ${summaryItem("Media type", detail.mediaType ? shortMediaType(detail.mediaType) : "")}
            ${summaryItem("Size", formatBytesText(detail.size))}
            ${summaryItem("Created", formatDateText(detail.createdAt))}
            ${summaryItem("Architectures", renderPlatforms(detail.platforms, "platform-list"))}
          </div>
        </section>
        ${(Array.isArray(detail.images) ? detail.images : []).map(renderImageDetail).join("")}
      </div>
    `;
  }

  function renderImageDetail(image, index) {
    const title = image.platform || `Image ${index + 1}`;
    return `
      <section class="detail-card image-detail-card">
        <div class="detail-card-head">
          <div>
            <h3>${escapeHtml(title)}</h3>
            <span class="muted">${escapeHtml(shortDigest(image.digest || ""))}</span>
          </div>
          ${image.mediaType ? `<span class="badge">${escapeHtml(shortMediaType(image.mediaType))}</span>` : ""}
        </div>

        <div class="summary-grid compact">
          ${summaryItem("Digest", renderCopyValue(image.digest, image.digest, shortDigest(image.digest)))}
          ${summaryItem("Config", renderCopyValue(image.configDigest, image.configDigest, shortDigest(image.configDigest)))}
          ${summaryItem("Compressed size", formatBytesText(image.size))}
          ${summaryItem("Created", formatDateText(image.createdAt))}
          ${summaryItem("OS", image.os)}
          ${summaryItem("Architecture", image.architecture)}
          ${summaryItem("Variant", image.variant)}
          ${summaryItem("Author", image.author)}
          ${summaryItem("User", image.user)}
          ${summaryItem("Working dir", image.workingDir)}
          ${summaryItem("Entrypoint", formatCommand(image.entrypoint))}
          ${summaryItem("Cmd", formatCommand(image.cmd))}
        </div>

        <div class="detail-grid-two">
          <div>
            <h4>Labels</h4>
            ${renderKeyValueTable(image.labels, "No labels")}
          </div>
          <div>
            <h4>Build args</h4>
            ${renderSimpleList(image.args, "No build args found in image history")}
          </div>
        </div>

        <h4>Environment</h4>
        ${renderSimpleList(image.env, "No environment values")}

        <h4>Layers</h4>
        ${renderLayerTable(image.layers)}

        <h4>Reconstructed Dockerfile</h4>
        <p class="section-note">Built from image history. Exact original Dockerfile comments, multi-line formatting and build-time values may not be present in the registry metadata.</p>
        ${renderDockerfileEditor(image.instructions)}
      </section>
    `;
  }

  function renderLayerTable(layers) {
    const rows = Array.isArray(layers) ? layers : [];
    if (rows.length === 0) return `<div class="empty-inline">No layers</div>`;
    return `
      <div class="table-wrap detail-table-wrap">
        <table class="compact-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Digest</th>
              <th>Instruction</th>
              <th>Increase</th>
              <th>Cumulative</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>${rows.map((layer) => `
            <tr>
              <td>${Number(layer.index || 0)}</td>
              <td>${renderCopyValue(layer.digest, layer.digest, shortDigest(layer.digest))}</td>
              <td>${layer.instruction ? `<span class="code instruction-code">${highlightDockerInstruction(layer.instruction)}</span>` : mutedDash()}</td>
              <td>${formatBytes(layer.size)}</td>
              <td>${formatBytes(layer.cumulativeSize)}</td>
              <td>${formatDate(layer.createdAt)}</td>
            </tr>
          `).join("")}</tbody>
        </table>
      </div>
    `;
  }

  function renderDockerfileEditor(instructions) {
    const rows = Array.isArray(instructions) ? instructions : [];
    if (rows.length === 0) return `<div class="empty-inline">No Dockerfile history</div>`;
    return `
      <div class="docker-editor" role="region" aria-label="Reconstructed Dockerfile">
        ${rows.map(renderDockerfileEditorLine).join("")}
      </div>
    `;
  }

  function renderDockerfileEditorLine(item) {
    const instruction = item.instruction || "";
    const line = Number(item.line || 0);
    const classes = ["docker-editor-line"];
    if (item.synthetic) classes.push("is-synthetic");
    return `
      <div class="${classes.join(" ")}" title="${escapeAttr(dockerLineTitle(item))}">
        <code class="docker-code">${highlightDockerInstruction(instruction)}</code>
        <span class="docker-meta">${dockerLineMeta(item)}</span>
        <span class="docker-ln">${line}</span>
      </div>
    `;
  }

  function dockerLineMeta(item) {
    if (item.synthetic) return `<span>inferred</span>`;
    const parts = [];
    const date = formatDateText(item.createdAt);
    if (date) parts.push(`<span>${escapeHtml(date)}</span>`);
    if (item.layerDigest) {
      parts.push(`<span title="${escapeAttr(item.layerDigest)}">${escapeHtml(shortDigest(item.layerDigest))}</span>`);
      const increase = formatBytesText(item.layerSize);
      const cumulative = formatBytesText(item.cumulativeSize);
      if (increase) parts.push(`<span>+${escapeHtml(increase)}</span>`);
      if (cumulative) parts.push(`<span>${escapeHtml(cumulative)}</span>`);
    } else {
      parts.push(`<span>metadata</span>`);
    }
    return parts.join("");
  }

  function dockerLineTitle(item) {
    const parts = [];
    if (item.synthetic) parts.push("Inferred base image");
    if (item.createdAt) parts.push(`Updated: ${formatDateText(item.createdAt)}`);
    if (item.layerDigest) parts.push(`Layer: ${item.layerDigest}`);
    if (item.layerSize) parts.push(`Increase: ${formatBytesText(item.layerSize)}`);
    if (item.cumulativeSize) parts.push(`Cumulative: ${formatBytesText(item.cumulativeSize)}`);
    return parts.join(" | ");
  }

  function renderKeyValueTable(values, empty) {
    if (!values || typeof values !== "object" || Object.keys(values).length === 0) return `<div class="empty-inline">${escapeHtml(empty)}</div>`;
    return `
      <div class="kv-table">
        ${Object.keys(values).sort().map((key) => `
          <div class="kv-key">${escapeHtml(key)}</div>
          <div class="kv-value">${escapeHtml(values[key])}</div>
        `).join("")}
      </div>
    `;
  }

  function renderSimpleList(values, empty) {
    const list = Array.isArray(values) ? values.filter(Boolean) : [];
    if (list.length === 0) return `<div class="empty-inline">${escapeHtml(empty)}</div>`;
    return `<div class="pill-list">${list.map((value) => `<span class="code">${escapeHtml(value)}</span>`).join("")}</div>`;
  }

  function summaryItem(label, value) {
    const rendered = value && String(value).includes("<") ? value : escapeHtml(value || "—");
    return `<div class="summary-item"><span>${escapeHtml(label)}</span><strong>${rendered || mutedDash()}</strong></div>`;
  }

  function renderCopyValue(raw, title, display) {
    if (!raw) return mutedDash();
    return `
      <span class="copy-value" title="${escapeAttr(title || raw)}">
        <span class="code">${escapeHtml(display || raw)}</span>
        <button class="inline-icon" type="button" data-action="copy" data-value="${escapeAttr(raw)}" title="Copy" aria-label="Copy">
          ${icon("content-copy")}
        </button>
      </span>
    `;
  }

  function footer(label, cursor, action) {
    return `
      <div class="footer-row">
        <div class="footer-left">
          <span>${escapeHtml(label)}${state.loading ? " · loading..." : ""}</span>
        </div>
        <div class="footer-right">
          <label class="footer-size">
            <span>Page size</span>
            <select data-role="page-size" autocomplete="off">
              ${PAGE_SIZES.map((size) => `<option value="${size}" ${state.pageSize === size ? "selected" : ""}>${size}</option>`).join("")}
            </select>
          </label>
          ${cursor ? `<button class="btn small" type="button" data-action="${action}" ${state.loading ? "disabled" : ""}>Load more</button>` : ""}
        </div>
      </div>
    `;
  }

  function emptyState(title, message) {
    return `<div class="empty"><div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(message)}</p></div></div>`;
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
      if (action === "copy") copyText(actionEl.dataset.value || "");
      if (action === "catalog-more") loadCatalog(true);
      if (action === "tags-more") loadTags(true);
      if (action === "delete-tag") deleteTag(actionEl.dataset.tag || "");
      closeMenus();
      return;
    }

    const repoRow = event.target.closest("tr[data-repo]");
    if (repoRow) {
      setRouteRepository(repoRow.dataset.repo || "");
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
    const ok = window.confirm(`Delete ${state.repo}:${tag}?\n\nThis removes the manifest reference from the registry.`);
    if (!ok) return;

    try {
      await api.deleteTag({ repo: state.repo, tag });
      state.tags = state.tags.filter((item) => item.name !== tag);
      if (state.view === "tag-detail") setRouteRepository(state.repo);
      toast("Tag deleted");
    } catch (error) {
      toast(error.message || String(error));
    } finally {
      renderContent();
    }
  }

  async function copyText(value) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      toast("Copied");
    } catch (_) {
      const input = document.createElement("textarea");
      input.value = value;
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      input.remove();
      toast("Copied");
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

    const rect = trigger.getBoundingClientRect();
    const width = popover.offsetWidth || 220;
    const height = popover.offsetHeight || 160;
    let left = Math.max(8, rect.right - width);
    let top = rect.bottom + 8;

    left = Math.min(left, window.innerWidth - width - 8);
    if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 8);

    popover.style.position = "fixed";
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
    popover.style.visibility = "visible";
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
  function toast(message) {
    window.clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.classList.remove("hidden");
    toastTimer = window.setTimeout(() => els.toast.classList.add("hidden"), 2600);
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
    return `<time datetime="${escapeAttr(date.toISOString())}">${escapeHtml(text)}</time>`;
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
    return `${amount.toFixed(amount >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
  }

  function formatCommand(value) {
    if (Array.isArray(value)) return value.length ? value.join(" ") : "";
    return value || "";
  }

  function highlightDockerInstruction(value) {
    const escaped = escapeHtml(value || "");
    return escaped
      .replace(/^([A-Z][A-Z0-9_-]*)(\s|$)/, '<span class="docker-keyword">$1</span>$2')
      .replace(/(\s--[a-zA-Z0-9][^\s=]*)(=|\s|$)/g, '<span class="docker-flag">$1</span>$2')
      .replace(/(\s#.*)$/g, '<span class="docker-comment">$1</span>');
  }

  function icon(name) {
    const paths = {
      "arrow-left": "M20,11H7.83L13.42,5.41L12,4L4,12L12,20L13.41,18.59L7.83,13H20V11Z",
      "content-copy": "M19,21H8V7H19M19,5H8A2,2 0 0,0 6,7V21A2,2 0 0,0 8,23H19A2,2 0 0,0 21,21V7A2,2 0 0,0 19,5M16,1H4A2,2 0 0,0 2,3V17H4V3H16V1Z",
      "download": "M5,20H19V18H5M19,9H15V3H9V9H5L12,16L19,9Z",
      "delete-outline": "M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19M8,9H16V19H8V9M15.5,4L14.5,3H9.5L8.5,4H5V6H19V4H15.5Z",
      "dots-vertical": "M12,8A2,2 0 0,0 14,6A2,2 0 0,0 12,4A2,2 0 0,0 10,6A2,2 0 0,0 12,8M12,10A2,2 0 0,0 10,12A2,2 0 0,0 12,14A2,2 0 0,0 14,12A2,2 0 0,0 12,10M12,16A2,2 0 0,0 10,18A2,2 0 0,0 12,20A2,2 0 0,0 14,18A2,2 0 0,0 12,16Z"
    };
    const path = paths[name] || paths["dots-vertical"];
    return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${path}"></path></svg>`;
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
