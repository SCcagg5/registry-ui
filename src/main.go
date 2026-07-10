package main

import (
	"context"
	"embed"
	"encoding/base64"
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
	"strconv"
	"strings"
	"time"
)

var version = "dev"

//go:embed public
var publicFS embed.FS

type publicConfig struct {
	Name            string `json:"name"`
	Version         string `json:"version"`
	Title           string `json:"title"`
	RegistryTitle   string `json:"registryTitle"`
	RegistryURL     string `json:"registryUrl"`
	PullURL         string `json:"pullUrl"`
	ProxyEnabled    bool   `json:"proxyEnabled"`
	DeleteEnabled   bool   `json:"deleteEnabled"`
	CatalogPageSize int    `json:"catalogPageSize"`
	TagsPageSize    int    `json:"tagsPageSize"`
}

type serverConfig struct {
	Listen          string
	Port            string
	RegistryURL     string
	Title           string
	RegistryTitle   string
	PullURL         string
	CatalogPageSize int
	TagsPageSize    int
	DeleteEnabled   bool
	UpstreamAuth    string
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

func envInt(name string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
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
	if value := firstEnv("REGISTRY_PROXY_PASS_URL", "NGINX_PROXY_PASS_URL", "REGISTRY_URL"); value != "" {
		return strings.TrimRight(value, "/")
	}
	return "http://registry:5000"
}

func inferPullURL(registryURL string) string {
	if value := strings.TrimSpace(os.Getenv("PULL_URL")); value != "" {
		return strings.TrimRight(value, "/")
	}
	parsed, err := url.Parse(registryURL)
	if err == nil && parsed.Host != "" {
		return parsed.Host
	}
	return "localhost:5000"
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
	registryURL := registryURLFromEnv()
	return serverConfig{
		Listen:          env("LISTEN_ADDR", ":"+port),
		Port:            port,
		RegistryURL:     registryURL,
		Title:           env("REGISTRY_UI_TITLE", env("DOCKER_REGISTRY_UI_TITLE", "Registry UI")),
		RegistryTitle:   env("REGISTRY_TITLE", "Docker Registry"),
		PullURL:         inferPullURL(registryURL),
		CatalogPageSize: envInt("CATALOG_PAGE_SIZE", envInt("CATALOG_ELEMENTS_LIMIT", 100)),
		TagsPageSize:    envInt("TAGS_PAGE_SIZE", envInt("TAGLIST_PAGE_SIZE", 100)),
		DeleteEnabled:   envBool("DELETE_IMAGES", false),
		UpstreamAuth:    upstreamAuthFromEnv(),
	}
}

func publicAppConfig(cfg serverConfig) publicConfig {
	return publicConfig{
		Name:            "registry-ui",
		Version:         version,
		Title:           cfg.Title,
		RegistryTitle:   cfg.RegistryTitle,
		RegistryURL:     "",
		PullURL:         cfg.PullURL,
		ProxyEnabled:    true,
		DeleteEnabled:   cfg.DeleteEnabled,
		CatalogPageSize: cfg.CatalogPageSize,
		TagsPageSize:    cfg.TagsPageSize,
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

func configHandler(cfg serverConfig) http.Handler {
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
		writeJSON(w, http.StatusOK, publicAppConfig(cfg))
	})
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

func appHandler(cfg serverConfig) http.Handler {
	mux := http.NewServeMux()
	proxy := registryProxy(cfg)
	config := configHandler(cfg)
	mux.Handle("/config.json", config)
	mux.Handle("/api/config", config)
	mux.Handle("/health", healthHandler("health"))
	mux.Handle("/healthz", healthHandler("healthz"))
	mux.Handle("/ready", healthHandler("ready"))
	mux.Handle("/v2", proxy)
	mux.Handle("/v2/", proxy)
	mux.Handle("/", staticHandler())
	return mux
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
  PULL_URL                 Pull host shown in commands, default registry host
  REGISTRY_UI_TITLE        Header title, default Registry UI
  REGISTRY_TITLE           Registry label, default Docker Registry
  DELETE_IMAGES            Enable delete action, default false
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
