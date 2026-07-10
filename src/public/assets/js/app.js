(() => {
  "use strict";

  const api = window.RegistryUIApi;
  const $ = (selector) => document.querySelector(selector);

  const PAGE_SIZES = [25, 50, 100];

  const state = {
    config: null,
    view: "repositories",
    repo: "",
    repositories: [],
    tags: [],
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
    els.viewSubtitle = $("#viewSubtitle");
    els.searchInput = $("#searchInput");
    els.pageSizeSelect = $("#pageSizeSelect");
    els.refreshBtn = $("#refreshBtn");
    els.notice = $("#notice");
    els.content = $("#content");
    els.toast = $("#toast");
  }

  function bindEvents() {
    els.refreshBtn.addEventListener("click", () => reloadCurrent());
    els.backBtn.addEventListener("click", () => setRouteRepositories());
    els.searchInput.addEventListener("input", () => {
      state.filter = els.searchInput.value.trim().toLowerCase();
      renderContent();
    });
    els.pageSizeSelect.addEventListener("change", () => {
      state.pageSize = Number(els.pageSizeSelect.value || 25);
      normalizePageSize();
      localStorage.setItem("registry-ui-page-size", String(state.pageSize));
      reloadCurrent();
    });
    document.addEventListener("click", onDocumentClick);
  }

  function normalizePageSize() {
    if (!PAGE_SIZES.includes(state.pageSize)) state.pageSize = 25;
    if (els.pageSizeSelect) els.pageSizeSelect.value = String(state.pageSize);
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
    state.repo = route.repo;
    state.filter = "";
    state.error = "";
    els.searchInput.value = "";
    renderChrome();
    renderNotice();

    if (state.view === "tags") await loadTags(false);
    else await loadCatalog(false);
  }

  function parseRoute() {
    const hash = window.location.hash || "#/";
    if (hash.startsWith("#/repository/")) {
      return { view: "tags", repo: decodeURIComponent(hash.slice("#/repository/".length)) };
    }
    return { view: "repositories", repo: "" };
  }

  function setRouteRepositories() { window.location.hash = "#/"; }
  function setRouteRepository(repo) { window.location.hash = `#/repository/${encodeURIComponent(repo)}`; }

  function renderChrome() {
    const cfg = state.config || {};
    const isRepo = state.view === "tags";
    document.title = isRepo ? `${state.repo} · Registry UI` : "Registry UI";
    els.versionBadge.textContent = cfg.version || "dev";
    els.backBtn.classList.toggle("hidden", !isRepo);
    els.viewTitle.textContent = isRepo ? state.repo : "Repositories";
    els.viewSubtitle.textContent = isRepo ? "Available image tags" : "Docker Registry catalog";
    els.searchInput.placeholder = isRepo ? "Filter tags" : "Image or namespace";
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
    if (state.view === "tags") await loadTags(false);
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

  function renderContent() {
    if (state.loading && currentItems().length === 0) {
      els.content.innerHTML = `<div class="loading"><div><div class="skeleton"></div><h3>Loading</h3><p>Reading registry metadata.</p></div></div>`;
      return;
    }

    if (state.error) {
      els.content.innerHTML = `<div class="error"><div><h3>Unable to read the registry</h3><p>${escapeHtml(state.error)}</p></div></div>`;
      return;
    }

    if (state.view === "tags") renderTags();
    else renderRepositories();
  }

  function currentItems() { return state.view === "tags" ? state.tags : state.repositories; }
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
            <span class="item-icon">R</span>
            <div>
              <div class="item-name" title="${escapeAttr(repo.name)}">${escapeHtml(repo.name)}</div>
              <div class="item-sub">Open tags</div>
            </div>
          </div>
        </td>
        <td>${renderCount(repo.tagCount, repo.tagsTruncated)}</td>
        <td>${repo.latestTag ? `<span class="code">${escapeHtml(repo.latestTag)}</span>` : mutedDash()}</td>
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
              <th>Type</th>
              <th>Size</th>
              <th>Created</th>
              <th class="is-right">Actions</th>
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
    const deleteButton = state.config.deleteEnabled
      ? `<button class="btn small danger" type="button" data-action="delete-tag" data-tag="${escapeAttr(tag.name)}">Delete</button>`
      : "";
    return `
      <tr>
        <td>
          <div class="item-main">
            <span class="item-icon">T</span>
            <div>
              <div class="item-name" title="${escapeAttr(tag.name)}">${escapeHtml(tag.name)}</div>
              <div class="item-sub">${escapeHtml(state.repo)}</div>
            </div>
          </div>
        </td>
        <td>${tag.digest ? `<span class="code digest" title="${escapeAttr(tag.digest)}">${escapeHtml(shortDigest(tag.digest))}</span>` : mutedDash()}</td>
        <td>${tag.mediaType ? `<span class="badge">${escapeHtml(shortMediaType(tag.mediaType))}</span>` : mutedDash()}</td>
        <td>${formatBytes(tag.size)}</td>
        <td>${formatDate(tag.createdAt)}</td>
        <td>
          <div class="actions">
            <button class="btn small" type="button" data-action="copy" data-value="${escapeAttr(imageRef)}">Copy</button>
            <a class="btn small" href="${escapeAttr(api.downloadURL(state.repo, tag.name))}" download>Download</a>
            ${deleteButton}
          </div>
        </td>
      </tr>
    `;
  }

  function footer(label, cursor, action) {
    return `
      <div class="footer-row">
        <span>${escapeHtml(label)}${state.loading ? " · loading..." : ""}</span>
        ${cursor ? `<button class="btn small" type="button" data-action="${action}" ${state.loading ? "disabled" : ""}>Load more</button>` : `<span>End of list</span>`}
      </div>
    `;
  }

  function emptyState(title, message) {
    return `<div class="empty"><div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(message)}</p></div></div>`;
  }

  async function onDocumentClick(event) {
    const button = event.target.closest("[data-action]");
    if (button) {
      event.preventDefault();
      event.stopPropagation();
      const action = button.dataset.action;
      if (action === "open-repo") setRouteRepository(button.dataset.repo || "");
      if (action === "copy") copyText(button.dataset.value || "");
      if (action === "catalog-more") loadCatalog(true);
      if (action === "tags-more") loadTags(true);
      if (action === "delete-tag") deleteTag(button.dataset.tag || "");
      return;
    }

    const row = event.target.closest("tr[data-repo]");
    if (row) setRouteRepository(row.dataset.repo || "");
  }

  async function deleteTag(tag) {
    if (!state.config.deleteEnabled || !tag) return;
    const ok = window.confirm(`Delete ${state.repo}:${tag}?\n\nThis removes the manifest reference from the registry.`);
    if (!ok) return;

    try {
      await api.deleteTag({ repo: state.repo, tag });
      state.tags = state.tags.filter((item) => item.name !== tag);
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

  let toastTimer = 0;
  function toast(message) {
    window.clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.classList.remove("hidden");
    toastTimer = window.setTimeout(() => els.toast.classList.add("hidden"), 2600);
  }

  function renderCount(count, truncated) {
    if (typeof count !== "number" || count < 0) return mutedDash();
    return `<span class="badge">${truncated ? "≥ " : ""}${count}</span>`;
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
    if (!value) return mutedDash();
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return mutedDash();
    return `<time datetime="${escapeAttr(date.toISOString())}">${escapeHtml(date.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }))}</time>`;
  }

  function formatBytes(value) {
    const size = Number(value || 0);
    if (!Number.isFinite(size) || size <= 0) return mutedDash();
    const units = ["B", "KB", "MB", "GB", "TB"];
    let unit = 0;
    let amount = size;
    while (amount >= 1024 && unit < units.length - 1) {
      amount /= 1024;
      unit += 1;
    }
    return `${amount.toFixed(amount >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
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
