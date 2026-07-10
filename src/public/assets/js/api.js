window.RegistryUIApi = (() => {
  "use strict";

  function scriptBase() {
    const script = document.currentScript || document.querySelector('script[src$="assets/js/api.js"]');
    if (!script) return new URL("./", window.location.href);
    return new URL("../../", script.src);
  }

  const base = scriptBase();

  function appURL(path) {
    return new URL(String(path || "").replace(/^\/+/, ""), base).toString();
  }

  function requestOptions(options = {}) {
    return {
      method: options.method || "GET",
      headers: options.headers || {},
      credentials: "same-origin",
      cache: options.cache || "no-store"
    };
  }

  async function describeError(response) {
    let body = "";
    try { body = await response.text(); } catch (_) { body = ""; }
    if (body) {
      try {
        const parsed = JSON.parse(body);
        if (parsed.error) return parsed.error;
        if (Array.isArray(parsed.errors) && parsed.errors.length) {
          return parsed.errors.map((item) => item.message || item.code).filter(Boolean).join(", ");
        }
      } catch (_) {
        return body.slice(0, 320);
      }
    }
    return response.statusText || `HTTP ${response.status}`;
  }

  async function request(path, options = {}) {
    const response = await fetch(appURL(path), requestOptions(options));
    if (!response.ok) {
      const message = await describeError(response);
      throw new Error(`${response.status} ${message}`);
    }
    return response;
  }

  async function json(path, options = {}) {
    const response = await request(path, {
      ...options,
      headers: { Accept: "application/json", ...(options.headers || {}) }
    });
    return { response, data: await response.json() };
  }

  function params(values) {
    const out = new URLSearchParams();
    Object.entries(values).forEach(([key, value]) => {
      if (value !== undefined && value !== null && String(value) !== "") out.set(key, value);
    });
    return out.toString();
  }

  async function config() {
    const response = await fetch(appURL("config.json"), requestOptions({ headers: { Accept: "application/json" } }));
    if (!response.ok) throw new Error(`config.json returned ${response.status}`);
    return response.json();
  }

  async function catalog({ pageSize, cursor } = {}) {
    return json(`api/catalog?${params({ n: pageSize, last: cursor })}`);
  }

  async function tags({ repo, pageSize, cursor } = {}) {
    return json(`api/tags?${params({ repo, n: pageSize, last: cursor })}`);
  }

  async function deleteTag({ repo, tag } = {}) {
    return json(`api/delete?${params({ repo, tag })}`, { method: "DELETE" });
  }

  function downloadURL(repo, tag) {
    return appURL(`api/download?${params({ repo, tag })}`);
  }

  return { appURL, config, catalog, tags, deleteTag, downloadURL };
})();
