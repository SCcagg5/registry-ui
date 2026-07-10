package main

import (
	"archive/tar"
	"bytes"
	"context"
	"crypto/sha256"
	"embed"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log"
	"mime"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

var version = "dev"

//go:embed public
var publicFS embed.FS

const (
	defaultPageSize       = 25
	maxMetadataBatchJobs  = 6
	maxRepositoryTagScan  = 5000
	registryRequestLimit  = 32 << 20
	ociImageLayoutVersion = "1.0.0"
)

var manifestAccept = strings.Join([]string{
	"application/vnd.oci.image.index.v1+json",
	"application/vnd.oci.image.manifest.v1+json",
	"application/vnd.docker.distribution.manifest.list.v2+json",
	"application/vnd.docker.distribution.manifest.v2+json",
	"application/vnd.docker.distribution.manifest.v1+json",
}, ", ")

type publicConfig struct {
	Name          string `json:"name"`
	Version       string `json:"version"`
	ProxyEnabled  bool   `json:"proxyEnabled"`
	DeleteEnabled bool   `json:"deleteEnabled"`
}

type serverConfig struct {
	Listen        string
	Port          string
	RegistryURL   string
	DeleteEnabled bool
	UpstreamAuth  string
}

type app struct {
	cfg         serverConfig
	registry    *registryClient
	deleteMutex sync.Mutex
	deleteKnown bool
	deleteOK    bool
}

type registryClient struct {
	base *url.URL
	auth string
	http *http.Client
}

type catalogResponse struct {
	Repositories []string `json:"repositories"`
}

type tagsResponse struct {
	Name string   `json:"name"`
	Tags []string `json:"tags"`
}

type descriptor struct {
	MediaType string            `json:"mediaType,omitempty"`
	Digest    string            `json:"digest,omitempty"`
	Size      int64             `json:"size,omitempty"`
	Platform  *platform         `json:"platform,omitempty"`
	Ann       map[string]string `json:"annotations,omitempty"`
}

type platform struct {
	OS           string `json:"os,omitempty"`
	Architecture string `json:"architecture,omitempty"`
	Variant      string `json:"variant,omitempty"`
}

type manifestEnvelope struct {
	SchemaVersion int          `json:"schemaVersion"`
	MediaType     string       `json:"mediaType,omitempty"`
	Config        *descriptor  `json:"config,omitempty"`
	Layers        []descriptor `json:"layers,omitempty"`
	Manifests     []descriptor `json:"manifests,omitempty"`
}

type manifestData struct {
	Descriptor descriptor
	Body       []byte
	Envelope   manifestEnvelope
}

type tagSummary struct {
	Name      string   `json:"name"`
	Digest    string   `json:"digest,omitempty"`
	MediaType string   `json:"mediaType,omitempty"`
	Size      int64    `json:"size,omitempty"`
	CreatedAt string   `json:"createdAt,omitempty"`
	Platforms []string `json:"platforms,omitempty"`
}

type repositorySummary struct {
	Name          string `json:"name"`
	TagCount      int    `json:"tagCount"`
	TagsTruncated bool   `json:"tagsTruncated,omitempty"`
	Size          int64  `json:"size,omitempty"`
	SizeTruncated bool   `json:"sizeTruncated,omitempty"`
	LatestTag     string `json:"latestTag,omitempty"`
	UpdatedAt     string `json:"updatedAt,omitempty"`
	Digest        string `json:"digest,omitempty"`
	MediaType     string `json:"mediaType,omitempty"`
}

type apiCatalogResponse struct {
	Repositories  []repositorySummary `json:"repositories"`
	Next          string              `json:"next,omitempty"`
	PageSize      int                 `json:"pageSize"`
	DeleteEnabled bool                `json:"deleteEnabled"`
}

type apiTagsResponse struct {
	Repository    string       `json:"repository"`
	Tags          []tagSummary `json:"tags"`
	Next          string       `json:"next,omitempty"`
	PageSize      int          `json:"pageSize"`
	DeleteEnabled bool         `json:"deleteEnabled"`
}

type tagDetailResponse struct {
	Repository    string        `json:"repository"`
	Tag           string        `json:"tag"`
	Digest        string        `json:"digest,omitempty"`
	MediaType     string        `json:"mediaType,omitempty"`
	Size          int64         `json:"size,omitempty"`
	CreatedAt     string        `json:"createdAt,omitempty"`
	Platforms     []string      `json:"platforms,omitempty"`
	Images        []imageDetail `json:"images,omitempty"`
	DeleteEnabled bool          `json:"deleteEnabled"`
}

type imageDetail struct {
	Platform     string              `json:"platform,omitempty"`
	Digest       string              `json:"digest,omitempty"`
	MediaType    string              `json:"mediaType,omitempty"`
	Size         int64               `json:"size,omitempty"`
	ConfigDigest string              `json:"configDigest,omitempty"`
	ConfigSize   int64               `json:"configSize,omitempty"`
	CreatedAt    string              `json:"createdAt,omitempty"`
	Author       string              `json:"author,omitempty"`
	OS           string              `json:"os,omitempty"`
	Architecture string              `json:"architecture,omitempty"`
	Variant      string              `json:"variant,omitempty"`
	User         string              `json:"user,omitempty"`
	WorkingDir   string              `json:"workingDir,omitempty"`
	Entrypoint   []string            `json:"entrypoint,omitempty"`
	Cmd          []string            `json:"cmd,omitempty"`
	Env          []string            `json:"env,omitempty"`
	Labels       map[string]string   `json:"labels,omitempty"`
	Args         []string            `json:"args,omitempty"`
	ExposedPorts []string            `json:"exposedPorts,omitempty"`
	Volumes      []string            `json:"volumes,omitempty"`
	StopSignal   string              `json:"stopSignal,omitempty"`
	RootFSType   string              `json:"rootFSType,omitempty"`
	Layers       []layerDetail       `json:"layers,omitempty"`
	Instructions []instructionDetail `json:"instructions,omitempty"`
}

type layerDetail struct {
	Index           int    `json:"index"`
	Digest          string `json:"digest,omitempty"`
	DiffID          string `json:"diffID,omitempty"`
	MediaType       string `json:"mediaType,omitempty"`
	Size            int64  `json:"size,omitempty"`
	CumulativeSize  int64  `json:"cumulativeSize,omitempty"`
	Instruction     string `json:"instruction,omitempty"`
	InstructionLine int    `json:"instructionLine,omitempty"`
	CreatedAt       string `json:"createdAt,omitempty"`
}

type instructionDetail struct {
	Line           int    `json:"line"`
	Instruction    string `json:"instruction,omitempty"`
	CreatedAt      string `json:"createdAt,omitempty"`
	EmptyLayer     bool   `json:"emptyLayer,omitempty"`
	Synthetic      bool   `json:"synthetic,omitempty"`
	LayerIndex     int    `json:"layerIndex"`
	LayerDigest    string `json:"layerDigest,omitempty"`
	LayerSize      int64  `json:"layerSize,omitempty"`
	CumulativeSize int64  `json:"cumulativeSize,omitempty"`
}

type imageConfig struct {
	Created      string             `json:"created,omitempty"`
	Author       string             `json:"author,omitempty"`
	Architecture string             `json:"architecture,omitempty"`
	OS           string             `json:"os,omitempty"`
	Variant      string             `json:"variant,omitempty"`
	Config       imageConfigRuntime `json:"config,omitempty"`
	RootFS       imageRootFS        `json:"rootfs,omitempty"`
	History      []imageHistory     `json:"history,omitempty"`
}

type imageConfigRuntime struct {
	User         string            `json:"User,omitempty"`
	Env          []string          `json:"Env,omitempty"`
	Entrypoint   stringList        `json:"Entrypoint,omitempty"`
	Cmd          stringList        `json:"Cmd,omitempty"`
	WorkingDir   string            `json:"WorkingDir,omitempty"`
	Labels       map[string]string `json:"Labels,omitempty"`
	ExposedPorts map[string]any    `json:"ExposedPorts,omitempty"`
	Volumes      map[string]any    `json:"Volumes,omitempty"`
	StopSignal   string            `json:"StopSignal,omitempty"`
}

type imageRootFS struct {
	Type    string   `json:"type,omitempty"`
	DiffIDs []string `json:"diff_ids,omitempty"`
}

type imageHistory struct {
	Created    string `json:"created,omitempty"`
	CreatedBy  string `json:"created_by,omitempty"`
	Author     string `json:"author,omitempty"`
	Comment    string `json:"comment,omitempty"`
	EmptyLayer bool   `json:"empty_layer,omitempty"`
}

type stringList []string

type imageArchive struct {
	Manifest descriptor
	Body     []byte
	Config   descriptor
	Layers   []descriptor
	Tag      string
}

func (s *stringList) UnmarshalJSON(body []byte) error {
	trimmed := bytes.TrimSpace(body)
	if bytes.Equal(trimmed, []byte("null")) {
		*s = nil
		return nil
	}
	var items []string
	if err := json.Unmarshal(trimmed, &items); err == nil {
		*s = items
		return nil
	}
	var single string
	if err := json.Unmarshal(trimmed, &single); err == nil {
		if strings.TrimSpace(single) == "" {
			*s = nil
		} else {
			*s = []string{single}
		}
		return nil
	}
	*s = nil
	return nil
}

func env(name, fallback string) string {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	return value
}

func firstEnv(names ...string) string {
	for _, name := range names {
		if value := strings.TrimSpace(os.Getenv(name)); value != "" {
			return value
		}
	}
	return ""
}

func envBool(name string, fallback bool) bool {
	value := strings.ToLower(strings.TrimSpace(os.Getenv(name)))
	if value == "" {
		return fallback
	}
	switch value {
	case "1", "true", "yes", "y", "on", "enabled":
		return true
	case "0", "false", "no", "n", "off", "disabled":
		return false
	default:
		return fallback
	}
}

func registryURLFromEnv() string {
	if value := firstEnv("REGISTRY_PROXY_PASS_URL", "REGISTRY_URL", "NGINX_PROXY_PASS_URL"); value != "" {
		return strings.TrimRight(value, "/")
	}
	return "http://registry:5000"
}

func upstreamAuthFromEnv() string {
	if raw := strings.TrimSpace(os.Getenv("REGISTRY_BASIC_AUTH")); raw != "" {
		if strings.Contains(raw, " ") {
			return raw
		}
		return "Basic " + raw
	}
	if token := strings.TrimSpace(os.Getenv("REGISTRY_TOKEN")); token != "" {
		return "Bearer " + token
	}
	user := strings.TrimSpace(firstEnv("REGISTRY_USERNAME", "REGISTRY_USER"))
	pass := firstEnv("REGISTRY_PASSWORD", "REGISTRY_PASS")
	if user == "" && pass == "" {
		return ""
	}
	return "Basic " + base64.StdEncoding.EncodeToString([]byte(user+":"+pass))
}

func loadConfig() serverConfig {
	port := env("PORT", "8080")
	return serverConfig{
		Listen:        env("LISTEN_ADDR", ":"+port),
		Port:          port,
		RegistryURL:   registryURLFromEnv(),
		DeleteEnabled: envBool("DELETE_IMAGES", false),
		UpstreamAuth:  upstreamAuthFromEnv(),
	}
}

func newRegistryClient(cfg serverConfig) (*registryClient, error) {
	base, err := url.Parse(cfg.RegistryURL)
	if err != nil || base.Scheme == "" || base.Host == "" {
		return nil, fmt.Errorf("invalid registry upstream: %q", cfg.RegistryURL)
	}
	return &registryClient{
		base: base,
		auth: cfg.UpstreamAuth,
		http: &http.Client{Timeout: 0},
	}, nil
}

func publicAppConfig(deleteEnabled bool) publicConfig {
	return publicConfig{
		Name:          "registry-ui",
		Version:       version,
		ProxyEnabled:  true,
		DeleteEnabled: deleteEnabled,
	}
}

func setSecurityHeaders(w http.ResponseWriter) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "same-origin")
	w.Header().Set("X-Frame-Options", "SAMEORIGIN")
}

func serveIndex(w http.ResponseWriter, sub fs.FS) {
	content, err := fs.ReadFile(sub, "index.html")
	if err != nil {
		http.Error(w, "index.html not found", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(content)
}

func staticHandler() http.Handler {
	sub, err := fs.Sub(publicFS, "public")
	if err != nil {
		log.Fatalf("open embedded public directory: %v", err)
	}

	files := http.FileServer(http.FS(sub))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		setSecurityHeaders(w)

		cleanPath := path.Clean("/" + r.URL.Path)
		if cleanPath == "/" {
			cleanPath = "/index.html"
		}

		name := strings.TrimPrefix(cleanPath, "/")
		if name == "index.html" {
			serveIndex(w, sub)
			return
		}

		if _, err := fs.Stat(sub, name); err != nil {
			serveIndex(w, sub)
			return
		}

		if strings.HasPrefix(name, "assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}
		files.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	setSecurityHeaders(w)
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]string{"error": err.Error()})
}

func corsHeaders(w http.ResponseWriter) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS, DELETE")
	w.Header().Set("Access-Control-Allow-Headers", "Authorization, Accept, Cache-Control, Content-Type, Docker-Content-Digest, If-Modified-Since, If-None-Match, Origin, Range")
	w.Header().Set("Access-Control-Expose-Headers", "Docker-Content-Digest, Docker-Distribution-Api-Version, ETag, Link, Location, WWW-Authenticate, Content-Length, Content-Type")
}

func registryProxy(cfg serverConfig) http.Handler {
	target, err := url.Parse(cfg.RegistryURL)
	if err != nil || target.Scheme == "" || target.Host == "" {
		log.Fatalf("invalid registry upstream: %q", cfg.RegistryURL)
	}

	proxy := httputil.NewSingleHostReverseProxy(target)
	originalDirector := proxy.Director

	proxy.Director = func(req *http.Request) {
		originalHost := req.Host
		originalProto := "http"
		if req.TLS != nil {
			originalProto = "https"
		}
		if forwardedProto := req.Header.Get("X-Forwarded-Proto"); forwardedProto != "" {
			originalProto = forwardedProto
		}

		originalDirector(req)
		req.Host = target.Host
		req.Header.Set("X-Forwarded-Host", originalHost)
		req.Header.Set("X-Forwarded-Proto", originalProto)
		if cfg.UpstreamAuth != "" && req.Header.Get("Authorization") == "" {
			req.Header.Set("Authorization", cfg.UpstreamAuth)
		}
	}

	proxy.ModifyResponse = func(resp *http.Response) error {
		resp.Header.Set("X-Registry-UI-Proxy", "true")
		return nil
	}

	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		setSecurityHeaders(w)
		corsHeaders(w)
		writeJSON(w, http.StatusBadGateway, map[string]string{
			"error": fmt.Sprintf("registry proxy error: %v", err),
		})
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		setSecurityHeaders(w)
		corsHeaders(w)
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		proxy.ServeHTTP(w, r)
	})
}

func healthHandler(name string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if r.Method == http.MethodHead {
			setSecurityHeaders(w)
			w.WriteHeader(http.StatusOK)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{
			"name":    "registry-ui",
			"status":  "ok",
			"check":   name,
			"version": version,
			"time":    time.Now().UTC().Format(time.RFC3339),
		})
	})
}

func (a *app) configHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if r.Method == http.MethodHead {
			setSecurityHeaders(w)
			w.WriteHeader(http.StatusOK)
			return
		}
		writeJSON(w, http.StatusOK, publicAppConfig(a.deleteAllowed(r.Context())))
	})
}

func (a *app) catalogHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		pageSize := parsePageSize(r.URL.Query().Get("n"))
		last := strings.TrimSpace(r.URL.Query().Get("last"))
		repos, next, err := a.registry.listCatalog(r.Context(), pageSize, last)
		if err != nil {
			writeError(w, http.StatusBadGateway, err)
			return
		}
		summaries := a.enrichRepositories(r.Context(), repos)
		writeJSON(w, http.StatusOK, apiCatalogResponse{
			Repositories:  summaries,
			Next:          next,
			PageSize:      pageSize,
			DeleteEnabled: a.deleteAllowed(r.Context()),
		})
	})
}

func (a *app) tagsHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		repo := strings.TrimSpace(r.URL.Query().Get("repo"))
		if repo == "" {
			writeError(w, http.StatusBadRequest, errors.New("missing repo"))
			return
		}
		pageSize := parsePageSize(r.URL.Query().Get("n"))
		last := strings.TrimSpace(r.URL.Query().Get("last"))
		tags, next, err := a.registry.listTags(r.Context(), repo, pageSize, last)
		if err != nil {
			writeError(w, http.StatusBadGateway, err)
			return
		}
		writeJSON(w, http.StatusOK, apiTagsResponse{
			Repository:    repo,
			Tags:          a.enrichTags(r.Context(), repo, tags),
			Next:          next,
			PageSize:      pageSize,
			DeleteEnabled: a.deleteAllowed(r.Context()),
		})
	})
}

func (a *app) tagDetailHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		repo := strings.TrimSpace(r.URL.Query().Get("repo"))
		tag := strings.TrimSpace(r.URL.Query().Get("tag"))
		if repo == "" || tag == "" {
			writeError(w, http.StatusBadRequest, errors.New("missing repo or tag"))
			return
		}
		detail, err := a.registry.tagDetail(r.Context(), repo, tag)
		if err != nil {
			writeError(w, http.StatusBadGateway, err)
			return
		}
		detail.DeleteEnabled = a.deleteAllowed(r.Context())
		writeJSON(w, http.StatusOK, detail)
	})
}

func (a *app) deleteHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if !a.deleteAllowed(r.Context()) {
			writeError(w, http.StatusForbidden, errors.New("registry deletion is not enabled or not supported"))
			return
		}
		repo := strings.TrimSpace(r.URL.Query().Get("repo"))
		tag := strings.TrimSpace(r.URL.Query().Get("tag"))
		if repo == "" || tag == "" {
			writeError(w, http.StatusBadRequest, errors.New("missing repo or tag"))
			return
		}
		meta, err := a.registry.tagMetadata(r.Context(), repo, tag)
		if err != nil {
			writeError(w, http.StatusBadGateway, err)
			return
		}
		if meta.Digest == "" {
			writeError(w, http.StatusBadGateway, errors.New("manifest digest not found"))
			return
		}
		if err := a.registry.deleteManifest(r.Context(), repo, meta.Digest); err != nil {
			writeError(w, http.StatusBadGateway, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
	})
}

func (a *app) downloadHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		repo := strings.TrimSpace(r.URL.Query().Get("repo"))
		tag := strings.TrimSpace(r.URL.Query().Get("tag"))
		if repo == "" || tag == "" {
			writeError(w, http.StatusBadRequest, errors.New("missing repo or tag"))
			return
		}
		archive, err := a.registry.resolveArchive(r.Context(), repo, tag)
		if err != nil {
			writeError(w, http.StatusBadGateway, err)
			return
		}
		filename := sanitizeFileName(repo + "_" + tag + ".oci.tar")
		setSecurityHeaders(w)
		w.Header().Set("Content-Type", "application/x-tar")
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
		w.Header().Set("Cache-Control", "no-store")
		if r.Method == http.MethodHead {
			w.WriteHeader(http.StatusOK)
			return
		}
		if err := a.registry.writeOCIArchive(r.Context(), w, repo, archive); err != nil {
			log.Printf("download %s:%s failed: %v", repo, tag, err)
		}
	})
}

func (a *app) deleteAllowed(ctx context.Context) bool {
	if !a.cfg.DeleteEnabled {
		return false
	}
	a.deleteMutex.Lock()
	if a.deleteKnown {
		ok := a.deleteOK
		a.deleteMutex.Unlock()
		return ok
	}
	a.deleteMutex.Unlock()

	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	ok := a.registry.probeDelete(ctx)

	a.deleteMutex.Lock()
	a.deleteKnown = true
	a.deleteOK = ok
	a.deleteMutex.Unlock()
	return ok
}

func (a *app) enrichRepositories(ctx context.Context, repos []string) []repositorySummary {
	out := make([]repositorySummary, len(repos))
	var wg sync.WaitGroup
	sem := make(chan struct{}, maxMetadataBatchJobs)
	for i, repo := range repos {
		i, repo := i, repo
		out[i] = repositorySummary{Name: repo, TagCount: -1}
		wg.Add(1)
		go func() {
			defer wg.Done()
			select {
			case sem <- struct{}{}:
				defer func() { <-sem }()
			case <-ctx.Done():
				return
			}
			tags, truncated, err := a.registry.listAllTags(ctx, repo, maxRepositoryTagScan)
			if err != nil {
				return
			}
			summary := repositorySummary{Name: repo, TagCount: len(tags), TagsTruncated: truncated}
			latest := selectLatestTag(tags)
			summary.LatestTag = latest
			seenDigests := make(map[string]struct{}, len(tags))
			for _, tag := range tags {
				if ctx.Err() != nil {
					break
				}
				meta, err := a.registry.tagMetadata(ctx, repo, tag)
				if err != nil {
					continue
				}
				if meta.CreatedAt != "" {
					summary.UpdatedAt = latestTime(summary.UpdatedAt, meta.CreatedAt)
				}
				digestKey := meta.Digest
				if digestKey == "" {
					digestKey = tag
				}
				if _, ok := seenDigests[digestKey]; !ok {
					seenDigests[digestKey] = struct{}{}
					summary.Size += meta.Size
				}
				if tag == latest {
					summary.Digest = meta.Digest
					summary.MediaType = meta.MediaType
				}
			}
			summary.SizeTruncated = truncated
			out[i] = summary
		}()
	}
	wg.Wait()
	return out
}

func (a *app) enrichTags(ctx context.Context, repo string, tags []string) []tagSummary {
	out := make([]tagSummary, len(tags))
	var wg sync.WaitGroup
	sem := make(chan struct{}, maxMetadataBatchJobs)
	for i, tag := range tags {
		i, tag := i, tag
		out[i] = tagSummary{Name: tag}
		wg.Add(1)
		go func() {
			defer wg.Done()
			select {
			case sem <- struct{}{}:
				defer func() { <-sem }()
			case <-ctx.Done():
				return
			}
			meta, err := a.registry.tagMetadata(ctx, repo, tag)
			if err != nil {
				return
			}
			out[i] = meta
		}()
	}
	wg.Wait()
	return out
}

func (c *registryClient) request(ctx context.Context, method, requestPath string, headers http.Header, body io.Reader) (*http.Response, error) {
	target := *c.base
	target.Path = joinURLPath(c.base.Path, requestPath)
	target.RawQuery = ""
	if i := strings.IndexByte(requestPath, '?'); i >= 0 {
		target.Path = joinURLPath(c.base.Path, requestPath[:i])
		target.RawQuery = requestPath[i+1:]
	}
	req, err := http.NewRequestWithContext(ctx, method, target.String(), body)
	if err != nil {
		return nil, err
	}
	for key, values := range headers {
		for _, value := range values {
			req.Header.Add(key, value)
		}
	}
	if c.auth != "" && req.Header.Get("Authorization") == "" {
		req.Header.Set("Authorization", c.auth)
	}
	return c.http.Do(req)
}

func (c *registryClient) json(ctx context.Context, requestPath string, out any) (*http.Response, error) {
	resp, err := c.request(ctx, http.MethodGet, requestPath, http.Header{"Accept": []string{"application/json"}}, nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return resp, registryStatusError(resp)
	}
	return resp, json.NewDecoder(io.LimitReader(resp.Body, registryRequestLimit)).Decode(out)
}

func (c *registryClient) listCatalog(ctx context.Context, limit int, last string) ([]string, string, error) {
	query := url.Values{}
	query.Set("n", strconv.Itoa(limit))
	if last != "" {
		query.Set("last", last)
	}
	var data catalogResponse
	resp, err := c.json(ctx, "/v2/_catalog?"+query.Encode(), &data)
	if err != nil {
		return nil, "", err
	}
	return uniqueStrings(data.Repositories), nextCursor(resp.Header.Get("Link")), nil
}

func (c *registryClient) listTags(ctx context.Context, repo string, limit int, last string) ([]string, string, error) {
	query := url.Values{}
	query.Set("n", strconv.Itoa(limit))
	if last != "" {
		query.Set("last", last)
	}
	var data tagsResponse
	resp, err := c.json(ctx, fmt.Sprintf("/v2/%s/tags/list?%s", repoPath(repo), query.Encode()), &data)
	if err != nil {
		return nil, "", err
	}
	return uniqueStrings(data.Tags), nextCursor(resp.Header.Get("Link")), nil
}

func (c *registryClient) listAllTags(ctx context.Context, repo string, maxItems int) ([]string, bool, error) {
	var all []string
	last := ""
	for len(all) < maxItems {
		remaining := maxItems - len(all)
		limit := 1000
		if remaining < limit {
			limit = remaining
		}
		tags, next, err := c.listTags(ctx, repo, limit, last)
		if err != nil {
			return nil, false, err
		}
		all = append(all, tags...)
		if next == "" {
			return uniqueStrings(all), false, nil
		}
		last = next
	}
	return uniqueStrings(all), true, nil
}

func (c *registryClient) tagMetadata(ctx context.Context, repo, tag string) (tagSummary, error) {
	root, err := c.fetchManifest(ctx, repo, tag)
	if err != nil {
		return tagSummary{Name: tag}, err
	}
	meta := tagSummary{
		Name:      tag,
		Digest:    root.Descriptor.Digest,
		MediaType: root.Descriptor.MediaType,
		Size:      root.Descriptor.Size,
		Platforms: platformsFromManifest(root),
	}
	imageManifest := root
	if isIndexManifest(root) {
		selected, ok := selectManifest(root.Envelope.Manifests)
		if !ok {
			return meta, nil
		}
		child, err := c.fetchManifest(ctx, repo, selected.Digest)
		if err != nil {
			return meta, nil
		}
		imageManifest = child
	}
	if imageManifest.Envelope.Config != nil {
		meta.Size = imageManifest.Envelope.Config.Size
		if cfg, _, err := c.fetchImageConfig(ctx, repo, imageManifest.Envelope.Config.Digest); err == nil {
			meta.CreatedAt = normalizeTime(cfg.Created)
			if len(meta.Platforms) == 0 {
				if platform := platformFromConfig(cfg); platform != "" {
					meta.Platforms = []string{platform}
				}
			}
		} else if created, err := c.configCreated(ctx, repo, imageManifest.Envelope.Config.Digest); err == nil {
			meta.CreatedAt = created
		}
	}
	for _, layer := range imageManifest.Envelope.Layers {
		meta.Size += layer.Size
	}
	return meta, nil
}

func (c *registryClient) tagDetail(ctx context.Context, repo, tag string) (tagDetailResponse, error) {
	root, err := c.fetchManifest(ctx, repo, tag)
	if err != nil {
		return tagDetailResponse{}, err
	}

	detail := tagDetailResponse{
		Repository: repo,
		Tag:        tag,
		Digest:     root.Descriptor.Digest,
		MediaType:  root.Descriptor.MediaType,
		Size:       root.Descriptor.Size,
		Platforms:  platformsFromManifest(root),
	}

	if isIndexManifest(root) {
		for _, item := range root.Envelope.Manifests {
			platformName := platformToString(item.Platform)
			if platformName == "" {
				continue
			}
			child, err := c.fetchManifest(ctx, repo, item.Digest)
			if err != nil {
				continue
			}
			image, err := c.imageDetail(ctx, repo, item, child)
			if err != nil {
				continue
			}
			detail.Images = append(detail.Images, image)
			detail.Size += image.Size
			detail.CreatedAt = latestTime(detail.CreatedAt, image.CreatedAt)
		}
		if len(detail.Images) == 0 {
			return detail, errors.New("manifest index does not contain a readable image manifest")
		}
		return detail, nil
	}

	image, err := c.imageDetail(ctx, repo, root.Descriptor, root)
	if err != nil {
		return detail, err
	}
	detail.Images = []imageDetail{image}
	detail.Size = image.Size
	detail.CreatedAt = image.CreatedAt
	if len(detail.Platforms) == 0 && image.Platform != "" {
		detail.Platforms = []string{image.Platform}
	}
	return detail, nil
}

func (c *registryClient) imageDetail(ctx context.Context, repo string, desc descriptor, manifest manifestData) (imageDetail, error) {
	if manifest.Envelope.Config == nil {
		return imageDetail{}, errors.New("manifest does not contain an image config")
	}
	cfg, _, err := c.fetchImageConfig(ctx, repo, manifest.Envelope.Config.Digest)
	if err != nil {
		return imageDetail{}, err
	}

	layers, instructions := buildImageHistory(manifest.Envelope.Layers, cfg)
	platformName := platformToString(desc.Platform)
	if platformName == "" {
		platformName = platformFromConfig(cfg)
	}
	size := manifest.Envelope.Config.Size
	for _, layer := range manifest.Envelope.Layers {
		size += layer.Size
	}

	return imageDetail{
		Platform:     platformName,
		Digest:       manifest.Descriptor.Digest,
		MediaType:    manifest.Descriptor.MediaType,
		Size:         size,
		ConfigDigest: manifest.Envelope.Config.Digest,
		ConfigSize:   manifest.Envelope.Config.Size,
		CreatedAt:    normalizeTime(cfg.Created),
		Author:       firstNonEmpty(cfg.Author, historyAuthor(cfg.History)),
		OS:           cfg.OS,
		Architecture: cfg.Architecture,
		Variant:      cfg.Variant,
		User:         cfg.Config.User,
		WorkingDir:   cfg.Config.WorkingDir,
		Entrypoint:   []string(cfg.Config.Entrypoint),
		Cmd:          []string(cfg.Config.Cmd),
		Env:          cfg.Config.Env,
		Labels:       cfg.Config.Labels,
		Args:         detectBuildArgs(instructions),
		ExposedPorts: sortedMapKeys(cfg.Config.ExposedPorts),
		Volumes:      sortedMapKeys(cfg.Config.Volumes),
		StopSignal:   cfg.Config.StopSignal,
		RootFSType:   cfg.RootFS.Type,
		Layers:       layers,
		Instructions: instructions,
	}, nil
}

func (c *registryClient) fetchImageConfig(ctx context.Context, repo, digest string) (imageConfig, []byte, error) {
	body, err := c.readBlob(ctx, repo, digest, registryRequestLimit)
	if err != nil {
		return imageConfig{}, nil, err
	}
	var cfg imageConfig
	if err := json.Unmarshal(body, &cfg); err != nil {
		return imageConfig{}, body, err
	}
	return cfg, body, nil
}

func (c *registryClient) readBlob(ctx context.Context, repo, digest string, limit int64) ([]byte, error) {
	resp, err := c.request(ctx, http.MethodGet, fmt.Sprintf("/v2/%s/blobs/%s", repoPath(repo), refPath(digest)), nil, nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, registryStatusError(resp)
	}
	return io.ReadAll(io.LimitReader(resp.Body, limit))
}

func (c *registryClient) fetchManifest(ctx context.Context, repo, ref string) (manifestData, error) {
	headers := http.Header{"Accept": []string{manifestAccept}}
	resp, err := c.request(ctx, http.MethodGet, fmt.Sprintf("/v2/%s/manifests/%s", repoPath(repo), refPath(ref)), headers, nil)
	if err != nil {
		return manifestData{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return manifestData{}, registryStatusError(resp)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, registryRequestLimit))
	if err != nil {
		return manifestData{}, err
	}
	var envelope manifestEnvelope
	_ = json.Unmarshal(body, &envelope)
	mediaType := envelope.MediaType
	if mediaType == "" {
		mediaType = strings.Split(resp.Header.Get("Content-Type"), ";")[0]
	}
	digest := resp.Header.Get("Docker-Content-Digest")
	if digest == "" {
		digest = sha256Digest(body)
	}
	return manifestData{
		Descriptor: descriptor{MediaType: mediaType, Digest: digest, Size: int64(len(body))},
		Body:       body,
		Envelope:   envelope,
	}, nil
}

func (c *registryClient) configCreated(ctx context.Context, repo, digest string) (string, error) {
	resp, err := c.request(ctx, http.MethodGet, fmt.Sprintf("/v2/%s/blobs/%s", repoPath(repo), refPath(digest)), nil, nil)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", registryStatusError(resp)
	}
	var data struct {
		Created string `json:"created"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(&data); err != nil {
		return "", err
	}
	return normalizeTime(data.Created), nil
}

func (c *registryClient) deleteManifest(ctx context.Context, repo, digest string) error {
	resp, err := c.request(ctx, http.MethodDelete, fmt.Sprintf("/v2/%s/manifests/%s", repoPath(repo), refPath(digest)), nil, nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return registryStatusError(resp)
	}
	return nil
}

func (c *registryClient) probeDelete(ctx context.Context) bool {
	fakeDigest := "sha256:" + strings.Repeat("0", 64)
	resp, err := c.request(ctx, http.MethodDelete, "/v2/registry-ui-delete-probe/manifests/"+fakeDigest, nil, nil)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)
	switch resp.StatusCode {
	case http.StatusUnauthorized, http.StatusForbidden, http.StatusMethodNotAllowed, http.StatusNotImplemented:
		return false
	default:
		return resp.StatusCode >= 200 && resp.StatusCode < 500
	}
}

func (c *registryClient) resolveArchive(ctx context.Context, repo, tag string) (imageArchive, error) {
	root, err := c.fetchManifest(ctx, repo, tag)
	if err != nil {
		return imageArchive{}, err
	}
	manifest := root
	if isIndexManifest(root) {
		selected, ok := selectManifest(root.Envelope.Manifests)
		if !ok {
			return imageArchive{}, errors.New("manifest index does not contain a usable image manifest")
		}
		manifest, err = c.fetchManifest(ctx, repo, selected.Digest)
		if err != nil {
			return imageArchive{}, err
		}
	}
	if manifest.Envelope.Config == nil || len(manifest.Envelope.Layers) == 0 {
		return imageArchive{}, errors.New("manifest does not describe a downloadable image")
	}
	return imageArchive{
		Manifest: manifest.Descriptor,
		Body:     manifest.Body,
		Config:   *manifest.Envelope.Config,
		Layers:   manifest.Envelope.Layers,
		Tag:      tag,
	}, nil
}

func (c *registryClient) writeOCIArchive(ctx context.Context, w io.Writer, repo string, image imageArchive) error {
	tw := tar.NewWriter(w)
	defer tw.Close()

	if err := writeTarBytes(tw, "oci-layout", []byte(fmt.Sprintf(`{"imageLayoutVersion":"%s"}`+"\n", ociImageLayoutVersion))); err != nil {
		return err
	}

	manifestDescriptor := image.Manifest
	manifestDescriptor.Ann = map[string]string{"org.opencontainers.image.ref.name": image.Tag}
	index := struct {
		SchemaVersion int          `json:"schemaVersion"`
		Manifests     []descriptor `json:"manifests"`
	}{SchemaVersion: 2, Manifests: []descriptor{manifestDescriptor}}
	indexBody, err := json.MarshalIndent(index, "", "  ")
	if err != nil {
		return err
	}
	indexBody = append(indexBody, '\n')
	if err := writeTarBytes(tw, "index.json", indexBody); err != nil {
		return err
	}
	if err := writeTarBytes(tw, blobPath(image.Manifest.Digest), image.Body); err != nil {
		return err
	}
	if err := c.writeBlob(tw, ctx, repo, image.Config); err != nil {
		return err
	}
	for _, layer := range image.Layers {
		if err := c.writeBlob(tw, ctx, repo, layer); err != nil {
			return err
		}
	}
	return nil
}

func (c *registryClient) writeBlob(tw *tar.Writer, ctx context.Context, repo string, desc descriptor) error {
	name := blobPath(desc.Digest)
	if name == "" {
		return errors.New("invalid blob digest")
	}
	size := desc.Size
	if size <= 0 {
		var err error
		size, err = c.blobSize(ctx, repo, desc.Digest)
		if err != nil {
			return err
		}
	}
	resp, err := c.request(ctx, http.MethodGet, fmt.Sprintf("/v2/%s/blobs/%s", repoPath(repo), refPath(desc.Digest)), nil, nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return registryStatusError(resp)
	}
	if err := tw.WriteHeader(&tar.Header{Name: name, Mode: 0644, Size: size, ModTime: time.Unix(0, 0)}); err != nil {
		return err
	}
	_, err = io.Copy(tw, resp.Body)
	return err
}

func (c *registryClient) blobSize(ctx context.Context, repo, digest string) (int64, error) {
	resp, err := c.request(ctx, http.MethodHead, fmt.Sprintf("/v2/%s/blobs/%s", repoPath(repo), refPath(digest)), nil, nil)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return 0, registryStatusError(resp)
	}
	if resp.ContentLength > 0 {
		return resp.ContentLength, nil
	}
	return 0, errors.New("blob size not available")
}

func writeTarBytes(tw *tar.Writer, name string, body []byte) error {
	if err := tw.WriteHeader(&tar.Header{Name: name, Mode: 0644, Size: int64(len(body)), ModTime: time.Unix(0, 0)}); err != nil {
		return err
	}
	_, err := io.Copy(tw, bytes.NewReader(body))
	return err
}

func appHandler(cfg serverConfig) http.Handler {
	registry, err := newRegistryClient(cfg)
	if err != nil {
		log.Fatal(err)
	}
	a := &app{cfg: cfg, registry: registry}
	mux := http.NewServeMux()
	proxy := registryProxy(cfg)
	config := a.configHandler()
	mux.Handle("/config.json", config)
	mux.Handle("/api/config", config)
	mux.Handle("/api/catalog", a.catalogHandler())
	mux.Handle("/api/tags", a.tagsHandler())
	mux.Handle("/api/tag", a.tagDetailHandler())
	mux.Handle("/api/delete", a.deleteHandler())
	mux.Handle("/api/download", a.downloadHandler())
	mux.Handle("/health", healthHandler("health"))
	mux.Handle("/healthz", healthHandler("healthz"))
	mux.Handle("/ready", healthHandler("ready"))
	mux.Handle("/v2", proxy)
	mux.Handle("/v2/", proxy)
	mux.Handle("/", staticHandler())
	return prefixAware(mux)
}

func prefixAware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cleanPath := path.Clean("/" + r.URL.Path)
		if shouldRedirectToSlash(cleanPath, r.URL.Path) {
			target := cleanPath + "/"
			if r.URL.RawQuery != "" {
				target += "?" + r.URL.RawQuery
			}
			http.Redirect(w, r, target, http.StatusPermanentRedirect)
			return
		}
		if !isAppPath(cleanPath) {
			if stripped, ok := stripFirstSegment(cleanPath); ok && isAppPath(stripped) {
				clone := r.Clone(r.Context())
				clone.URL.Path = stripped
				clone.URL.RawPath = ""
				next.ServeHTTP(w, clone)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func isAppPath(value string) bool {
	if value == "/" || value == "/config.json" || value == "/api/config" || value == "/health" || value == "/healthz" || value == "/ready" || value == "/v2" {
		return true
	}
	for _, prefix := range []string{"/assets/", "/api/", "/v2/"} {
		if strings.HasPrefix(value, prefix) {
			return true
		}
	}
	return false
}

func stripFirstSegment(value string) (string, bool) {
	trimmed := strings.Trim(value, "/")
	if trimmed == "" {
		return "/", false
	}
	parts := strings.SplitN(trimmed, "/", 2)
	if len(parts) == 1 {
		return "/", true
	}
	return "/" + parts[1], true
}

func shouldRedirectToSlash(cleanPath, rawPath string) bool {
	if cleanPath == "/" || isAppPath(cleanPath) || strings.HasSuffix(rawPath, "/") {
		return false
	}
	trimmed := strings.Trim(cleanPath, "/")
	return trimmed != "" && !strings.Contains(trimmed, "/")
}

func serve() error {
	_ = mime.AddExtensionType(".js", "text/javascript; charset=utf-8")
	_ = mime.AddExtensionType(".css", "text/css; charset=utf-8")
	_ = mime.AddExtensionType(".svg", "image/svg+xml")

	cfg := loadConfig()
	server := &http.Server{
		Addr:              cfg.Listen,
		Handler:           appHandler(cfg),
		ReadHeaderTimeout: 10 * time.Second,
	}

	log.Printf("registry-ui %s listening on %s", version, cfg.Listen)
	log.Printf("registry upstream: %s", cfg.RegistryURL)
	return server.ListenAndServe()
}

func defaultHealthURL() string {
	if raw := strings.TrimSpace(os.Getenv("HEALTH_URL")); raw != "" {
		return raw
	}
	return "http://127.0.0.1:" + env("PORT", "8080") + "/healthz"
}

func defaultHealthTimeout() time.Duration {
	raw := env("HEALTH_TIMEOUT", "2s")
	value, err := time.ParseDuration(raw)
	if err != nil {
		return 2 * time.Second
	}
	return value
}

func runHealth(args []string) int {
	flags := flag.NewFlagSet("health", flag.ContinueOnError)
	flags.SetOutput(io.Discard)

	urlFlag := flags.String("url", defaultHealthURL(), "health URL")
	timeoutFlag := flags.Duration("timeout", defaultHealthTimeout(), "health timeout")
	quietFlag := flags.Bool("quiet", false, "suppress output")

	if err := flags.Parse(args); err != nil {
		fmt.Fprintf(os.Stderr, "invalid health arguments\n")
		return 2
	}

	if flags.NArg() > 0 && strings.TrimSpace(flags.Arg(0)) != "" {
		*urlFlag = flags.Arg(0)
	}

	ctx, cancel := context.WithTimeout(context.Background(), *timeoutFlag)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, *urlFlag, nil)
	if err != nil {
		if !*quietFlag {
			fmt.Fprintf(os.Stderr, "invalid health URL %q: %v\n", *urlFlag, err)
		}
		return 2
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		if !*quietFlag {
			fmt.Fprintf(os.Stderr, "registry-ui health check failed: %v\n", err)
		}
		return 1
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		if !*quietFlag {
			fmt.Fprintf(os.Stderr, "registry-ui health check failed: %s\n", resp.Status)
		}
		return 1
	}

	if !*quietFlag {
		fmt.Println("registry-ui health check ok")
	}
	return 0
}

func usage() {
	fmt.Fprintf(os.Stdout, `registry-ui %s

Usage:
  registry-ui              Start the web server
  registry-ui serve        Start the web server
  registry-ui health       Check the local health endpoint
  registry-ui health --url http://127.0.0.1:8080/healthz --timeout 3s
  registry-ui version      Print the version

Environment:
  PORT                     HTTP port, default 8080
  LISTEN_ADDR              Full listen address, default :$PORT
  REGISTRY_PROXY_PASS_URL  Docker Registry upstream, default http://registry:5000
  REGISTRY_URL             Alias for REGISTRY_PROXY_PASS_URL
  DELETE_IMAGES            Enable delete action when the registry supports it, default false
`, version)
}

func main() {
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "serve":
			if err := serve(); err != nil && !errors.Is(err, http.ErrServerClosed) {
				log.Fatal(err)
			}
			return
		case "health":
			os.Exit(runHealth(os.Args[2:]))
		case "version", "--version", "-v":
			fmt.Printf("registry-ui %s\n", version)
			return
		case "help", "--help", "-h":
			usage()
			return
		default:
			fmt.Fprintf(os.Stderr, "unknown command: %s\n\n", os.Args[1])
			usage()
			os.Exit(2)
		}
	}

	if err := serve(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

func parsePageSize(raw string) int {
	value, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil {
		return defaultPageSize
	}
	switch value {
	case 25, 50, 100:
		return value
	default:
		return defaultPageSize
	}
}

func repoPath(repo string) string {
	parts := strings.Split(repo, "/")
	for i, part := range parts {
		parts[i] = url.PathEscape(part)
	}
	return strings.Join(parts, "/")
}

func refPath(ref string) string {
	return url.PathEscape(ref)
}

func joinURLPath(basePath, requestPath string) string {
	if basePath == "" || basePath == "/" {
		return ensureSlash(requestPath)
	}
	return strings.TrimRight(basePath, "/") + ensureSlash(requestPath)
}

func ensureSlash(value string) string {
	if strings.HasPrefix(value, "/") {
		return value
	}
	return "/" + value
}

func nextCursor(linkHeader string) string {
	if linkHeader == "" {
		return ""
	}
	match := regexp.MustCompile(`<([^>]+)>\s*;\s*rel="?next"?`).FindStringSubmatch(linkHeader)
	if len(match) < 2 {
		return ""
	}
	parsed, err := url.Parse(match[1])
	if err != nil {
		return ""
	}
	return parsed.Query().Get("last")
}

func registryStatusError(resp *http.Response) error {
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	message := strings.TrimSpace(string(body))
	if message == "" {
		message = resp.Status
	}
	return fmt.Errorf("registry returned %s: %s", resp.Status, message)
}

func sha256Digest(body []byte) string {
	sum := sha256.Sum256(body)
	return "sha256:" + hex.EncodeToString(sum[:])
}

func isIndexManifest(data manifestData) bool {
	mediaType := data.Descriptor.MediaType
	return strings.Contains(mediaType, "manifest.list") || strings.Contains(mediaType, "image.index") || len(data.Envelope.Manifests) > 0
}

func selectManifest(items []descriptor) (descriptor, bool) {
	if len(items) == 0 {
		return descriptor{}, false
	}
	for _, item := range items {
		if item.Platform != nil && item.Platform.OS == "linux" && item.Platform.Architecture == "amd64" {
			return item, true
		}
	}
	for _, item := range items {
		if item.Platform != nil && item.Platform.OS == "linux" {
			return item, true
		}
	}
	return items[0], true
}

func normalizeTime(raw string) string {
	if raw == "" {
		return ""
	}
	if t, err := time.Parse(time.RFC3339Nano, raw); err == nil {
		return t.UTC().Format(time.RFC3339)
	}
	return raw
}

func uniqueStrings(items []string) []string {
	seen := make(map[string]struct{}, len(items))
	out := make([]string, 0, len(items))
	for _, item := range items {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		if _, ok := seen[item]; ok {
			continue
		}
		seen[item] = struct{}{}
		out = append(out, item)
	}
	return out
}

func selectLatestTag(tags []string) string {
	if len(tags) == 0 {
		return ""
	}
	type candidate struct {
		tag string
		ok  bool
		ver [3]int
	}
	candidates := make([]candidate, 0, len(tags))
	for _, tag := range tags {
		ver, ok := parseVersionTag(tag)
		candidates = append(candidates, candidate{tag: tag, ok: ok, ver: ver})
	}
	sort.SliceStable(candidates, func(i, j int) bool {
		if candidates[i].ok != candidates[j].ok {
			return candidates[i].ok
		}
		if candidates[i].ok && candidates[j].ok {
			for k := 0; k < 3; k++ {
				if candidates[i].ver[k] != candidates[j].ver[k] {
					return candidates[i].ver[k] > candidates[j].ver[k]
				}
			}
		}
		if strings.EqualFold(candidates[i].tag, "latest") {
			return true
		}
		if strings.EqualFold(candidates[j].tag, "latest") {
			return false
		}
		return candidates[i].tag > candidates[j].tag
	})
	return candidates[0].tag
}

func parseVersionTag(tag string) ([3]int, bool) {
	var out [3]int
	clean := strings.TrimPrefix(strings.ToLower(strings.TrimSpace(tag)), "v")
	parts := strings.Split(clean, ".")
	if len(parts) < 2 || len(parts) > 3 {
		return out, false
	}
	for i := range parts {
		part := parts[i]
		if cut := strings.IndexAny(part, "-+"); cut >= 0 {
			part = part[:cut]
		}
		value, err := strconv.Atoi(part)
		if err != nil {
			return out, false
		}
		out[i] = value
	}
	return out, true
}

func platformsFromManifest(data manifestData) []string {
	if isIndexManifest(data) {
		items := make([]string, 0, len(data.Envelope.Manifests))
		for _, item := range data.Envelope.Manifests {
			if platform := platformToString(item.Platform); platform != "" {
				items = append(items, platform)
			}
		}
		return uniqueStrings(items)
	}
	return nil
}

func platformToString(p *platform) string {
	if p == nil {
		return ""
	}
	osName := strings.TrimSpace(p.OS)
	arch := strings.TrimSpace(p.Architecture)
	variant := strings.TrimSpace(p.Variant)
	if osName == "" || arch == "" || (osName == "unknown" && arch == "unknown") {
		return ""
	}
	value := osName + "/" + arch
	if variant != "" {
		value += "/" + variant
	}
	return value
}

func platformFromConfig(cfg imageConfig) string {
	osName := strings.TrimSpace(cfg.OS)
	arch := strings.TrimSpace(cfg.Architecture)
	variant := strings.TrimSpace(cfg.Variant)
	if osName == "" || arch == "" || (osName == "unknown" && arch == "unknown") {
		return ""
	}
	value := osName + "/" + arch
	if variant != "" {
		value += "/" + variant
	}
	return value
}

func buildImageHistory(layerDescriptors []descriptor, cfg imageConfig) ([]layerDetail, []instructionDetail) {
	layers := make([]layerDetail, len(layerDescriptors))
	var cumulative int64
	for i, desc := range layerDescriptors {
		cumulative += desc.Size
		diffID := ""
		if i < len(cfg.RootFS.DiffIDs) {
			diffID = cfg.RootFS.DiffIDs[i]
		}
		layers[i] = layerDetail{
			Index:          i + 1,
			Digest:         desc.Digest,
			DiffID:         diffID,
			MediaType:      desc.MediaType,
			Size:           desc.Size,
			CumulativeSize: cumulative,
		}
	}

	instructions := make([]instructionDetail, 0, len(cfg.History)+1)
	nextLine := 1
	insertScratch := likelyScratchBase(cfg)
	scratchInserted := false
	layerIndex := 0
	var currentSize int64
	for _, history := range cfg.History {
		instruction := cleanDockerInstruction(history.CreatedBy)
		if instruction == "" {
			instruction = strings.TrimSpace(history.Comment)
		}
		if insertScratch && !scratchInserted && !isArgInstruction(instruction) {
			instructions = append(instructions, instructionDetail{
				Line:           nextLine,
				Instruction:    "FROM scratch",
				CreatedAt:      normalizeTime(history.Created),
				EmptyLayer:     true,
				Synthetic:      true,
				LayerIndex:     -1,
				CumulativeSize: currentSize,
			})
			nextLine++
			scratchInserted = true
		}
		item := instructionDetail{
			Line:           nextLine,
			Instruction:    instruction,
			CreatedAt:      normalizeTime(history.Created),
			EmptyLayer:     history.EmptyLayer,
			LayerIndex:     -1,
			CumulativeSize: currentSize,
		}
		if !history.EmptyLayer && layerIndex < len(layers) {
			layer := &layers[layerIndex]
			item.LayerIndex = layer.Index
			item.LayerDigest = layer.Digest
			item.LayerSize = layer.Size
			item.CumulativeSize = layer.CumulativeSize
			currentSize = layer.CumulativeSize
			layer.InstructionLine = item.Line
			layer.Instruction = instruction
			layer.CreatedAt = item.CreatedAt
			layerIndex++
		}
		instructions = append(instructions, item)
		nextLine++
	}
	if insertScratch && !scratchInserted {
		instructions = append(instructions, instructionDetail{
			Line:           nextLine,
			Instruction:    "FROM scratch",
			CreatedAt:      firstHistoryTime(cfg.History),
			EmptyLayer:     true,
			Synthetic:      true,
			LayerIndex:     -1,
			CumulativeSize: currentSize,
		})
	}
	return layers, instructions
}

func likelyScratchBase(cfg imageConfig) bool {
	if len(cfg.History) == 0 || hasExplicitBaseInstruction(cfg.History) || hasEnvKey(cfg.Config.Env, "PATH") {
		return false
	}
	first := ""
	for _, history := range cfg.History {
		first = cleanDockerInstruction(history.CreatedBy)
		if first == "" {
			first = strings.TrimSpace(history.Comment)
		}
		if first == "" || isArgInstruction(first) {
			continue
		}
		break
	}
	upper := strings.ToUpper(strings.TrimSpace(first))
	return strings.HasPrefix(upper, "ADD ") || strings.HasPrefix(upper, "COPY ")
}

func isArgInstruction(instruction string) bool {
	upper := strings.ToUpper(strings.TrimSpace(instruction))
	return upper == "ARG" || strings.HasPrefix(upper, "ARG ")
}

func hasExplicitBaseInstruction(history []imageHistory) bool {
	for _, item := range history {
		instruction := strings.ToUpper(strings.TrimSpace(cleanDockerInstruction(item.CreatedBy)))
		if instruction == "" {
			instruction = strings.ToUpper(strings.TrimSpace(item.Comment))
		}
		if instruction == "FROM" || strings.HasPrefix(instruction, "FROM ") {
			return true
		}
	}
	return false
}

func hasEnvKey(env []string, key string) bool {
	key = strings.ToUpper(strings.TrimSpace(key))
	for _, item := range env {
		name, _, _ := strings.Cut(item, "=")
		if strings.ToUpper(strings.TrimSpace(name)) == key {
			return true
		}
	}
	return false
}

func firstHistoryTime(history []imageHistory) string {
	for _, item := range history {
		if normalized := normalizeTime(item.Created); normalized != "" {
			return normalized
		}
	}
	return ""
}

func cleanDockerInstruction(raw string) string {
	value := strings.TrimSpace(raw)
	if value == "" {
		return ""
	}
	if strings.Contains(value, "#(nop)") {
		parts := strings.SplitN(value, "#(nop)", 2)
		return strings.TrimSpace(parts[1])
	}
	if strings.HasPrefix(value, "/bin/sh -c ") {
		return "RUN " + strings.TrimSpace(strings.TrimPrefix(value, "/bin/sh -c "))
	}
	if strings.HasPrefix(value, "RUN |") {
		if _, cmd, ok := strings.Cut(value, "/bin/sh -c "); ok {
			return "RUN " + strings.TrimSpace(cmd)
		}
	}
	return value
}

func detectBuildArgs(instructions []instructionDetail) []string {
	seen := map[string]struct{}{}
	var args []string
	for _, item := range instructions {
		value := strings.TrimSpace(item.Instruction)
		if len(value) < 4 || !strings.EqualFold(value[:3], "ARG") || !isSpaceOrEnd(value, 3) {
			continue
		}
		arg := strings.TrimSpace(value[3:])
		if arg == "" {
			continue
		}
		if _, ok := seen[arg]; ok {
			continue
		}
		seen[arg] = struct{}{}
		args = append(args, arg)
	}
	sort.Strings(args)
	return args
}

func isSpaceOrEnd(value string, index int) bool {
	if len(value) <= index {
		return true
	}
	return value[index] == ' ' || value[index] == '\t'
}

func sortedMapKeys[V any](items map[string]V) []string {
	if len(items) == 0 {
		return nil
	}
	out := make([]string, 0, len(items))
	for key := range items {
		out = append(out, key)
	}
	sort.Strings(out)
	return out
}

func historyAuthor(history []imageHistory) string {
	for i := len(history) - 1; i >= 0; i-- {
		if strings.TrimSpace(history[i].Author) != "" {
			return strings.TrimSpace(history[i].Author)
		}
	}
	return ""
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func latestTime(current, candidate string) string {
	if current == "" {
		return candidate
	}
	if candidate == "" {
		return current
	}
	ct, cErr := time.Parse(time.RFC3339, current)
	nt, nErr := time.Parse(time.RFC3339, candidate)
	if cErr != nil || nErr != nil {
		if candidate > current {
			return candidate
		}
		return current
	}
	if nt.After(ct) {
		return candidate
	}
	return current
}

func blobPath(digest string) string {
	algo, value, ok := strings.Cut(digest, ":")
	if !ok || algo == "" || value == "" {
		return ""
	}
	return "blobs/" + algo + "/" + value
}

func sanitizeFileName(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "image.oci.tar"
	}
	var b strings.Builder
	for _, r := range value {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == '.', r == '-', r == '_':
			b.WriteRune(r)
		default:
			b.WriteByte('_')
		}
	}
	return b.String()
}
