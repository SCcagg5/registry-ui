window.RegistryUIApi = (() => {
  "use strict";

  const manifestAccept = [
    "application/vnd.oci.image.index.v1+json",
    "application/vnd.oci.image.manifest.v1+json",
    "application/vnd.docker.distribution.manifest.list.v2+json",
    "application/vnd.docker.distribution.manifest.v2+json",
    "application/vnd.docker.distribution.manifest.v1+json"
  ].join(", ");

  function normalizeBase(base) {
    return String(base || "").replace(/\/+$/, "");
  }

  function registryURL(config, requestPath) {
    return normalizeBase(config.registryUrl) + requestPath;
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

  async function request(config, requestPath, options = {}) {
    const response = await fetch(registryURL(config, requestPath), requestOptions(options));
    if (!response.ok) {
      const message = await describeError(response);
      throw new Error(`${response.status} ${message}`);
    }
    return response;
  }

  async function json(config, requestPath, options = {}) {
    const response = await request(config, requestPath, {
      ...options,
      headers: { Accept: "application/json", ...(options.headers || {}) }
    });
    return { response, data: await response.json() };
  }

  function repoPath(repo) {
    return String(repo).split("/").map(encodeURIComponent).join("/");
  }

  function refPath(ref) {
    return encodeURIComponent(String(ref));
  }

  async function ping(config) {
    return fetch(registryURL(config, "/v2/"), requestOptions({ headers: { Accept: "application/json" } }));
  }

  async function manifestMetadata(config, repo, ref) {
    const path = `/v2/${repoPath(repo)}/manifests/${refPath(ref)}`;
    const headers = { Accept: manifestAccept };
    let response = await fetch(registryURL(config, path), requestOptions({ method: "HEAD", headers }));
    if (!response.ok && (response.status === 405 || response.status === 404)) {
      response = await fetch(registryURL(config, path), requestOptions({ method: "GET", headers }));
    }
    if (!response.ok) {
      const message = await describeError(response);
      throw new Error(`${response.status} ${message}`);
    }
    return {
      digest: response.headers.get("Docker-Content-Digest") || "",
      mediaType: response.headers.get("Content-Type") || "",
      contentLength: response.headers.get("Content-Length") || ""
    };
  }

  function nextCursor(linkHeader) {
    if (!linkHeader) return "";
    const match = String(linkHeader).match(/<([^>]+)>\s*;\s*rel="?next"?/i);
    if (!match) return "";
    try {
      const url = new URL(match[1], window.location.origin);
      return url.searchParams.get("last") || "";
    } catch (_) {
      return "";
    }
  }

  return { json, request, ping, manifestMetadata, nextCursor, repoPath, refPath };
})();
