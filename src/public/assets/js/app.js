(() => {
  "use strict";

  const api = window.RegistryUIApi;
  const $ = (selector) => document.querySelector(selector);

  const state = {
    config: null,
    view: "repositories",
    repo: "",
    repositories: [],
    tags: [],
    catalogCursor: "",
    tagsCursor: "",
    filter: "",
    loading: false,
    error: "",
    tagDetails: {},
    detailLoading: {}
  };

  const els = {};

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    cacheElements();
    bindEvents();
    await loadConfig();
    window.addEventListener("hashchange", navigate);
    await navigate();
    checkRegistry();
  }

  function cacheElements() {
    els.appTitle = $("#appTitle");
    els.registryTitle = $("#registryTitle");
    els.versionBadge = $("#versionBadge");
    els.registryStatus = $("#registryStatus");
    els.breadcrumbs = $("#breadcrumbs");
    els.backBtn = $("#backBtn");
    els.viewTitle = $("#viewTitle");
    els.viewSubtitle = $("#viewSubtitle");
    els.searchInput = $("#searchInput");
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
    document.addEventListener("click", onDocumentClick);
  }

  async function loadConfig() {
    try {
      const response = await fetch("config.json", { cache: "no-store" });
      state.config = await response.json();
    } catch (_) {
      state.config = {
        name: "registry-ui",
        version: "dev",
        title: "Registry UI",
        registryTitle: "Docker Registry",
        registryUrl: "",
        pullUrl: "",
        proxyEnabled: true,
        deleteEnabled: false,
        catalogPageSize: 100,
        tagsPageSize: 100
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

    if (state.view === "tags") {
      await loadTags(false);
    } else {
      await loadCatalog(false);
    }
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
    const cfg = state.config;
    document.title = `${cfg.title || "Registry UI"} · ${cfg.registryTitle || "Docker Registry"}`;
    els.appTitle.textContent = cfg.title || "Registry UI";
    els.registryTitle.textContent = cfg.registryTitle || "Docker Registry";
    els.versionBadge.textContent = cfg.version || "dev";

    const isRepo = state.view === "tags";
    els.backBtn.classList.toggle("hidden", !isRepo);
    els.viewTitle.textContent = isRepo ? state.repo : "Repositories";
    els.viewSubtitle.textContent = isRepo ? "Tags disponibles pour cette image" : "Catalogue Docker Registry";
    els.searchInput.placeholder = isRepo ? "Filtrer les tags" : "Image ou namespace";

    const crumbs = [`<button type="button" data-action="route-home">/</button>`, `<span>repositories</span>`];
    if (isRepo) crumbs.push(`<span>/</span><span title="${escapeAttr(state.repo)}">${escapeHtml(state.repo)}</span>`);
    els.breadcrumbs.innerHTML = crumbs.join("");
  }

  function renderNotice() {
    const cfg = state.config;
    const needsConfig = !cfg.registryUrl && !cfg.proxyEnabled;
    els.notice.className = needsConfig ? "notice warn" : "notice hidden";
    els.notice.textContent = needsConfig
      ? "Aucun proxy registry n'est configuré. Définis REGISTRY_PROXY_PASS_URL ou REGISTRY_URL."
      : "";
  }

  async function checkRegistry() {
    setStatus("neutral", "Vérification");
    try {
      const response = await api.ping(state.config);
      if (response.ok) setStatus("ok", "Connecté");
      else if (response.status === 401) setStatus("warn", "Auth requise");
      else setStatus("danger", `Erreur ${response.status}`);
    } catch (_) {
      setStatus("danger", "Injoignable");
    }
  }

  function setStatus(tone, label) {
    els.registryStatus.className = `status ${tone}`;
    els.registryStatus.textContent = label;
  }

  async function reloadCurrent() {
    checkRegistry();
    if (state.view === "tags") await loadTags(false);
    else await loadCatalog(false);
  }

  async function loadCatalog(append) {
    state.loading = true;
    state.error = "";
    renderContent();
    try {
      const cursor = append ? state.catalogCursor : "";
      const limit = Number(state.config.catalogPageSize || 100);
      const path = `/v2/_catalog?n=${encodeURIComponent(limit)}${cursor ? `&last=${encodeURIComponent(cursor)}` : ""}`;
      const { response, data } = await api.json(state.config, path);
      const incoming = Array.isArray(data.repositories) ? data.repositories : [];
      state.repositories = append ? unique([...state.repositories, ...incoming]) : incoming;
      state.catalogCursor = api.nextCursor(response.headers.get("Link"));
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
      const limit = Number(state.config.tagsPageSize || 100);
      const path = `/v2/${api.repoPath(state.repo)}/tags/list?n=${encodeURIComponent(limit)}${cursor ? `&last=${encodeURIComponent(cursor)}` : ""}`;
      const { response, data } = await api.json(state.config, path);
      const incoming = Array.isArray(data.tags) ? data.tags.filter(Boolean) : [];
      state.tags = append ? unique([...state.tags, ...incoming]) : incoming;
      state.tagsCursor = api.nextCursor(response.headers.get("Link"));
      if (!append) {
        state.tagDetails = {};
        state.detailLoading = {};
      }
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
      els.content.innerHTML = `<div class="loading"><div><div class="skeleton"></div><h3>Chargement</h3><p>Lecture du registre en cours.</p></div></div>`;
      return;
    }

    if (state.error) {
      els.content.innerHTML = `<div class="error"><div><h3>Impossible de lire le registre</h3><p>${escapeHtml(state.error)}</p></div></div>`;
      return;
    }

    if (state.view === "tags") renderTags();
    else renderRepositories();
  }

  function currentItems() { return state.view === "tags" ? state.tags : state.repositories; }
  function filteredRepositories() { return state.filter ? state.repositories.filter((repo) => repo.toLowerCase().includes(state.filter)) : state.repositories; }
  function filteredTags() { return state.filter ? state.tags.filter((tag) => tag.toLowerCase().includes(state.filter)) : state.tags; }

  function renderRepositories() {
    const repos = filteredRepositories();
    if (repos.length === 0) {
      els.content.innerHTML = emptyState("Aucune image", state.filter ? "Aucun repository ne correspond à la recherche." : "Le catalogue est vide ou le registre ne renvoie aucun repository.");
      return;
    }

    els.content.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Repository</th>
              <th>Commande</th>
              <th class="is-right">Actions</th>
            </tr>
          </thead>
          <tbody>${repos.map(renderRepositoryRow).join("")}</tbody>
        </table>
      </div>
      ${footer(`${repos.length} repository${repos.length > 1 ? "s" : ""}`, state.catalogCursor, "catalog-more")}
    `;
  }

  function renderRepositoryRow(repo) {
    const command = dockerPull(repo, "");
    return `
      <tr class="clickable-row" data-repo="${escapeAttr(repo)}">
        <td>
          <div class="item-main">
            <span class="item-icon">R</span>
            <div>
              <div class="item-name" title="${escapeAttr(repo)}">${escapeHtml(repo)}</div>
              <div class="item-sub">Clique pour afficher les tags</div>
            </div>
          </div>
        </td>
        <td><span class="code">${escapeHtml(command)}</span></td>
        <td>
          <div class="actions">
            <button class="btn small" type="button" data-action="copy" data-value="${escapeAttr(command)}">Copier</button>
            <button class="btn small primary" type="button" data-action="open-repo" data-repo="${escapeAttr(repo)}">Tags</button>
          </div>
        </td>
      </tr>
    `;
  }

  function renderTags() {
    const tags = filteredTags();
    if (tags.length === 0) {
      els.content.innerHTML = emptyState("Aucun tag", state.filter ? "Aucun tag ne correspond à la recherche." : "Ce repository ne contient aucun tag visible.");
      return;
    }

    els.content.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Tag</th>
              <th>Commande</th>
              <th>Manifest</th>
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
    const command = dockerPull(state.repo, tag);
    const detail = state.tagDetails[tag];
    const detailLoading = state.detailLoading[tag];
    const deleteButton = state.config.deleteEnabled
      ? `<button class="btn small danger" type="button" data-action="delete-tag" data-tag="${escapeAttr(tag)}">Supprimer</button>`
      : "";
    return `
      <tr>
        <td>
          <div class="item-main">
            <span class="item-icon">T</span>
            <div>
              <div class="item-name" title="${escapeAttr(tag)}">${escapeHtml(tag)}</div>
              <div class="item-sub">${escapeHtml(state.repo)}</div>
            </div>
          </div>
        </td>
        <td><span class="code">${escapeHtml(command)}</span></td>
        <td>${renderManifestCell(detail, detailLoading)}</td>
        <td>
          <div class="actions">
            <button class="btn small" type="button" data-action="copy" data-value="${escapeAttr(command)}">Copier</button>
            <button class="btn small" type="button" data-action="details" data-tag="${escapeAttr(tag)}" ${detailLoading ? "disabled" : ""}>Détails</button>
            ${deleteButton}
          </div>
        </td>
      </tr>
    `;
  }

  function renderManifestCell(detail, isLoading) {
    if (isLoading) return `<span class="badge">Lecture</span>`;
    if (!detail) return `<span class="badge">Non chargé</span>`;
    const digest = detail.digest || "digest indisponible";
    return `
      <div class="meta">
        <span class="code digest" title="${escapeAttr(digest)}">${escapeHtml(shortDigest(digest))}</span>
        ${detail.mediaType ? `<span class="badge">${escapeHtml(shortMediaType(detail.mediaType))}</span>` : ""}
      </div>
    `;
  }

  function footer(label, cursor, action) {
    return `
      <div class="footer-row">
        <span>${escapeHtml(label)}${state.loading ? " · chargement..." : ""}</span>
        ${cursor ? `<button class="btn small" type="button" data-action="${action}" ${state.loading ? "disabled" : ""}>Charger plus</button>` : `<span>Fin de liste</span>`}
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
      if (action === "route-home") setRouteRepositories();
      if (action === "open-repo") setRouteRepository(button.dataset.repo || "");
      if (action === "copy") copyText(button.dataset.value || "");
      if (action === "catalog-more") loadCatalog(true);
      if (action === "tags-more") loadTags(true);
      if (action === "details") loadTagDetails(button.dataset.tag || "");
      if (action === "delete-tag") deleteTag(button.dataset.tag || "");
      return;
    }

    const row = event.target.closest("tr[data-repo]");
    if (row) setRouteRepository(row.dataset.repo || "");
  }

  async function loadTagDetails(tag) {
    if (!tag) return;
    state.detailLoading[tag] = true;
    renderContent();
    try {
      state.tagDetails[tag] = await api.manifestMetadata(state.config, state.repo, tag);
      toast("Détails du manifest chargés");
    } catch (error) {
      toast(error.message || String(error));
    } finally {
      delete state.detailLoading[tag];
      renderContent();
    }
  }

  async function deleteTag(tag) {
    if (!state.config.deleteEnabled || !tag) return;
    const ok = window.confirm(`Supprimer le tag ${state.repo}:${tag} ?\n\nLe registre doit autoriser la suppression de manifests.`);
    if (!ok) return;

    state.detailLoading[tag] = true;
    renderContent();
    try {
      const detail = state.tagDetails[tag] || await api.manifestMetadata(state.config, state.repo, tag);
      if (!detail.digest) throw new Error("digest du manifest introuvable");
      await api.request(state.config, `/v2/${api.repoPath(state.repo)}/manifests/${api.refPath(detail.digest)}`, { method: "DELETE" });
      state.tags = state.tags.filter((item) => item !== tag);
      delete state.tagDetails[tag];
      toast("Tag supprimé");
    } catch (error) {
      toast(error.message || String(error));
    } finally {
      delete state.detailLoading[tag];
      renderContent();
    }
  }

  function dockerPull(repo, tag) {
    const prefix = state.config.pullUrl ? `${state.config.pullUrl}/` : "";
    return `docker pull ${prefix}${repo}${tag ? `:${tag}` : ""}`;
  }

  async function copyText(value) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      toast("Copié");
    } catch (_) {
      const input = document.createElement("textarea");
      input.value = value;
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      input.remove();
      toast("Copié");
    }
  }

  let toastTimer = 0;
  function toast(message) {
    window.clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.classList.remove("hidden");
    toastTimer = window.setTimeout(() => els.toast.classList.add("hidden"), 2600);
  }

  function unique(items) {
    return [...new Set(items.filter(Boolean))];
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
