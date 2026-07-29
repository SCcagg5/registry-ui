package main

import (
	"archive/tar"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

func TestRegistryURLFromEnvUsesOnlyRegistryURL(t *testing.T) {
	t.Setenv("REGISTRY_URL", "https://registry.example.test:5443/root/")

	if got, want := registryURLFromEnv(), "https://registry.example.test:5443/root"; got != want {
		t.Fatalf("registryURLFromEnv() = %q, want %q", got, want)
	}
}

func TestRegistryURLFromEnvUsesDefault(t *testing.T) {
	t.Setenv("REGISTRY_URL", "")

	if got, want := registryURLFromEnv(), "http://registry:5000"; got != want {
		t.Fatalf("registryURLFromEnv() = %q, want %q", got, want)
	}
}

func TestImageContentSizesSeparateLayersFromConfigMetadata(t *testing.T) {
	manifest := manifestData{
		Envelope: manifestEnvelope{
			Config: &descriptor{Size: 857},
			Layers: []descriptor{{Size: 167}},
		},
	}

	configSize, layerSize, totalSize := imageContentSizes(manifest)
	if configSize != 857 {
		t.Fatalf("config size = %d, want 857", configSize)
	}
	if layerSize != 167 {
		t.Fatalf("layer size = %d, want 167", layerSize)
	}
	if totalSize != 1024 {
		t.Fatalf("content size = %d, want 1024", totalSize)
	}
}

func TestCleanDockerInstructionUsesCanonicalDockerfileSyntax(t *testing.T) {
	tests := map[string]string{
		"COPY /out/rootfs/ / # buildkit":                                                       "COPY /out/rootfs/ /",
		"RUN /bin/sh -c apk add --no-cache ca-certificates":                                    "RUN apk add --no-cache ca-certificates",
		"EXPOSE map[8080/tcp:{} 5353/udp:{}]":                                                  "EXPOSE 8080 5353/udp",
		"ENTRYPOINT [\"/registry-ui\",\"serve\"]":                                              "ENTRYPOINT [\"/registry-ui\", \"serve\"]",
		"/bin/sh -c #(nop)  ENV PORT=8080":                                                     "ENV PORT=8080",
		`HEALTHCHECK &{["CMD" "/registry-ui" "health" "--quiet"] "30s" "3s" "5s" "0s" '\x03'}`: `HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD ["/registry-ui", "health", "--quiet"]`,
	}

	for input, want := range tests {
		if got := cleanDockerInstruction(input); got != want {
			t.Errorf("cleanDockerInstruction(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestBuildImageHistoryIncludesFromAndCanonicalMetadataInOrder(t *testing.T) {
	cfg := imageConfig{
		Created: "2026-07-29T14:57:00Z",
		Config: imageConfigRuntime{
			Env:          []string{"PATH=/usr/local/bin", "PORT=8080"},
			Entrypoint:   stringList{"/registry-ui"},
			ExposedPorts: map[string]any{"8080/tcp": map[string]any{}},
			Healthcheck: &imageHealthcheck{
				Test:        []string{"CMD", "/registry-ui", "health", "--quiet"},
				Interval:    30_000_000_000,
				Timeout:     3_000_000_000,
				StartPeriod: 5_000_000_000,
				Retries:     3,
			},
		},
		RootFS: imageRootFS{
			Type:    "layers",
			DiffIDs: []string{"sha256:diff"},
		},
		History: []imageHistory{
			{CreatedBy: "ENV PORT=8080", EmptyLayer: true},
			{CreatedBy: "COPY /out/rootfs/ / # buildkit"},
			{CreatedBy: "USER 65532:65532", EmptyLayer: true},
			{CreatedBy: "WORKDIR /", EmptyLayer: true},
			{CreatedBy: "EXPOSE map[8080/tcp:{}]", EmptyLayer: true},
			{CreatedBy: "STOPSIGNAL SIGTERM", EmptyLayer: true},
			{CreatedBy: "ENTRYPOINT [\"/registry-ui\"]", EmptyLayer: true},
			{CreatedBy: `HEALTHCHECK &{["CMD" "/registry-ui" "health" "--quiet"] "30s" "3s" "5s" "0s" '\x03'}`, EmptyLayer: true},
		},
	}

	layers, instructions := buildImageHistory([]descriptor{{
		Digest:    "sha256:layer",
		MediaType: "application/vnd.oci.image.layer.v1.tar+gzip",
		Size:      2_900_000,
	}}, cfg)

	var values []string
	for _, item := range instructions {
		values = append(values, item.Instruction)
	}
	want := strings.Join([]string{
		"FROM scratch",
		"ENV PORT=8080",
		"COPY /out/rootfs/ /",
		"USER 65532:65532",
		"WORKDIR /",
		"EXPOSE 8080",
		"STOPSIGNAL SIGTERM",
		"ENTRYPOINT [\"/registry-ui\"]",
		"HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD [\"/registry-ui\", \"health\", \"--quiet\"]",
	}, "\n")
	if got := strings.Join(values, "\n"); got != want {
		t.Fatalf("image history:\n%s\nwant:\n%s", got, want)
	}
	if len(layers) != 1 || layers[0].Instruction != "COPY /out/rootfs/ /" {
		t.Fatalf("filesystem layer mapping = %#v", layers)
	}
	if instructions[2].LayerDigest != "sha256:layer" || instructions[2].LayerSize != 2_900_000 {
		t.Fatalf("COPY layer mapping = %#v", instructions[2])
	}
	for _, item := range instructions {
		if item.Instruction != "COPY /out/rootfs/ /" && item.LayerSize != 0 {
			t.Fatalf("metadata instruction %q has layer size %d", item.Instruction, item.LayerSize)
		}
	}
}

func TestBuildImageHistoryUsesStandardBaseImageName(t *testing.T) {
	cfg := imageConfig{
		History: []imageHistory{{
			CreatedBy: "RUN echo ready",
		}},
	}

	_, instructions := buildImageHistory(
		[]descriptor{{Digest: "sha256:layer", Size: 42}},
		cfg,
		"docker.io/library/alpine:3.22",
	)
	if len(instructions) != 2 {
		t.Fatalf("instructions = %#v", instructions)
	}
	if got, want := instructions[0].Instruction, "FROM docker.io/library/alpine:3.22"; got != want {
		t.Fatalf("base instruction = %q, want %q", got, want)
	}
	if instructions[0].LayerSize != 0 || instructions[0].CumulativeSize != 0 {
		t.Fatalf("FROM must not claim a filesystem layer: %#v", instructions[0])
	}
	if instructions[1].LayerSize != 42 {
		t.Fatalf("inherited or application layer size = %d, want 42", instructions[1].LayerSize)
	}
}

func TestTagMetadataUsesAllPlatformImageContent(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Docker-Content-Digest", "sha256:"+strings.TrimPrefix(r.URL.Path, "/v2/example/manifests/"))
		switch r.URL.Path {
		case "/v2/example/manifests/latest":
			w.Header().Set("Content-Type", "application/vnd.oci.image.index.v1+json")
			_, _ = w.Write([]byte(`{
				"schemaVersion": 2,
				"mediaType": "application/vnd.oci.image.index.v1+json",
				"manifests": [
					{"mediaType":"application/vnd.oci.image.manifest.v1+json","digest":"sha256:amd64","size":400,"platform":{"os":"linux","architecture":"amd64"}},
					{"mediaType":"application/vnd.oci.image.manifest.v1+json","digest":"sha256:arm64","size":410,"platform":{"os":"linux","architecture":"arm64"}}
				]
			}`))
		case "/v2/example/manifests/sha256:amd64":
			w.Header().Set("Content-Type", "application/vnd.oci.image.manifest.v1+json")
			_, _ = w.Write([]byte(`{
				"schemaVersion": 2,
				"mediaType": "application/vnd.oci.image.manifest.v1+json",
				"config": {"mediaType":"application/vnd.oci.image.config.v1+json","digest":"sha256:config-amd64","size":100},
				"layers": [{"mediaType":"application/vnd.oci.image.layer.v1.tar+gzip","digest":"sha256:layer-amd64","size":900}]
			}`))
		case "/v2/example/manifests/sha256:arm64":
			w.Header().Set("Content-Type", "application/vnd.oci.image.manifest.v1+json")
			_, _ = w.Write([]byte(`{
				"schemaVersion": 2,
				"mediaType": "application/vnd.oci.image.manifest.v1+json",
				"config": {"mediaType":"application/vnd.oci.image.config.v1+json","digest":"sha256:config-arm64","size":120},
				"layers": [{"mediaType":"application/vnd.oci.image.layer.v1.tar+gzip","digest":"sha256:layer-arm64","size":1100}]
			}`))
		case "/v2/example/blobs/sha256:config-amd64":
			_, _ = w.Write([]byte(`{"created":"2026-07-29T14:00:00Z","architecture":"amd64","os":"linux"}`))
		case "/v2/example/blobs/sha256:config-arm64":
			_, _ = w.Write([]byte(`{"created":"2026-07-29T15:00:00Z","architecture":"arm64","os":"linux"}`))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(upstream.Close)

	client, err := newRegistryClient(serverConfig{RegistryURL: upstream.URL})
	if err != nil {
		t.Fatal(err)
	}
	meta, err := client.tagMetadata(context.Background(), "example", "latest")
	if err != nil {
		t.Fatal(err)
	}
	if meta.Size != 2220 {
		t.Fatalf("multi-platform tag size = %d, want 2220", meta.Size)
	}
	if meta.CreatedAt != "2026-07-29T15:00:00Z" {
		t.Fatalf("multi-platform created time = %q", meta.CreatedAt)
	}
}

func TestWriteDockerArchiveCreatesLoadableManifestLayout(t *testing.T) {
	configBody := []byte(`{"architecture":"amd64","os":"linux","rootfs":{"type":"layers","diff_ids":["sha256:diff"]}}`)
	layerBody := []byte("compressed-layer-blob")
	configDigest := sha256Digest(configBody)
	layerDigest := sha256Digest(layerBody)

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v2/example/blobs/" + configDigest:
			_, _ = w.Write(configBody)
		case "/v2/example/blobs/" + layerDigest:
			_, _ = w.Write(layerBody)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(upstream.Close)

	client, err := newRegistryClient(serverConfig{RegistryURL: upstream.URL})
	if err != nil {
		t.Fatal(err)
	}
	image := imageArchive{
		Config: descriptor{
			Digest: configDigest,
			Size:   int64(len(configBody)),
		},
		Layers: []descriptor{{
			Digest: layerDigest,
			Size:   int64(len(layerBody)),
		}},
		Tag: "1.0.0",
	}

	var archive bytes.Buffer
	if err := client.writeDockerArchive(context.Background(), &archive, "example", image); err != nil {
		t.Fatal(err)
	}

	entries := make(map[string][]byte)
	reader := tar.NewReader(bytes.NewReader(archive.Bytes()))
	for {
		header, err := reader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		body, err := io.ReadAll(reader)
		if err != nil {
			t.Fatal(err)
		}
		entries[header.Name] = body
	}

	configName, err := dockerArchiveBlobName(configDigest, ".json")
	if err != nil {
		t.Fatal(err)
	}
	layerName, err := dockerArchiveBlobName(layerDigest, ".tar")
	if err != nil {
		t.Fatal(err)
	}
	var manifest []struct {
		Config   string   `json:"Config"`
		RepoTags []string `json:"RepoTags"`
		Layers   []string `json:"Layers"`
	}
	if err := json.Unmarshal(entries["manifest.json"], &manifest); err != nil {
		t.Fatal(err)
	}
	if len(manifest) != 1 || manifest[0].Config != configName {
		t.Fatalf("Docker manifest = %#v", manifest)
	}
	if len(manifest[0].RepoTags) != 1 || manifest[0].RepoTags[0] != "example:1.0.0" {
		t.Fatalf("Docker RepoTags = %#v", manifest[0].RepoTags)
	}
	if len(manifest[0].Layers) != 1 || manifest[0].Layers[0] != layerName {
		t.Fatalf("Docker Layers = %#v", manifest[0].Layers)
	}
	if !bytes.Equal(entries[configName], configBody) {
		t.Fatal("Docker archive config blob changed")
	}
	if !bytes.Equal(entries[layerName], layerBody) {
		t.Fatal("Docker archive layer blob changed")
	}
}

func TestCatalogUsesConfiguredRegistry(t *testing.T) {
	var (
		mu    sync.Mutex
		paths []string
	)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		paths = append(paths, r.URL.RequestURI())
		mu.Unlock()

		switch r.URL.Path {
		case "/v2/_catalog":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"repositories":[]}`))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(upstream.Close)

	handler := newTestAppHandler(t, upstream.URL)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/catalog?n=25", nil))

	if response.Code != http.StatusOK {
		t.Fatalf("GET /api/catalog status = %d, body = %s", response.Code, response.Body.String())
	}
	var catalog apiCatalogResponse
	if err := json.Unmarshal(response.Body.Bytes(), &catalog); err != nil {
		t.Fatalf("decode catalog: %v", err)
	}
	if len(catalog.Repositories) != 0 {
		t.Fatalf("catalog repositories = %#v, want empty", catalog.Repositories)
	}

	mu.Lock()
	defer mu.Unlock()
	if len(paths) != 1 || paths[0] != "/v2/_catalog?n=25" {
		t.Fatalf("upstream requests = %#v", paths)
	}
}

func TestRegistryProxyPreservesConfiguredPathPrefix(t *testing.T) {
	var receivedPath string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedPath = r.URL.Path
		w.Header().Set("Docker-Distribution-Api-Version", "registry/2.0")
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(upstream.Close)

	handler := newTestAppHandler(t, upstream.URL+"/internal")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/v2/", nil))

	if response.Code != http.StatusOK {
		t.Fatalf("GET /v2/ status = %d, body = %s", response.Code, response.Body.String())
	}
	if receivedPath != "/internal/v2/" {
		t.Fatalf("upstream path = %q, want /internal/v2/", receivedPath)
	}
	if got := response.Header().Get("X-Registry-UI-Proxy"); got != "true" {
		t.Fatalf("X-Registry-UI-Proxy = %q, want true", got)
	}
}

func TestUIAndAPIWorkBehindOnePathPrefix(t *testing.T) {
	handler := newTestAppHandler(t, "http://127.0.0.1:1")

	page := httptest.NewRecorder()
	handler.ServeHTTP(page, httptest.NewRequest(http.MethodGet, "/registry-ui/", nil))
	if page.Code != http.StatusOK {
		t.Fatalf("GET /registry-ui/ status = %d", page.Code)
	}
	if !strings.Contains(page.Body.String(), "Registry UI") {
		t.Fatal("prefixed page does not contain Registry UI")
	}

	config := httptest.NewRecorder()
	handler.ServeHTTP(config, httptest.NewRequest(http.MethodGet, "/registry-ui/config.json", nil))
	if config.Code != http.StatusOK {
		t.Fatalf("GET prefixed config status = %d", config.Code)
	}
	var value publicConfig
	if err := json.Unmarshal(config.Body.Bytes(), &value); err != nil {
		t.Fatalf("decode config: %v", err)
	}
	if value.Name != "registry-ui" || !value.ProxyEnabled {
		t.Fatalf("unexpected public config: %#v", value)
	}
}

func TestHealthEndpoint(t *testing.T) {
	handler := newTestAppHandler(t, "http://127.0.0.1:1")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/healthz", nil))

	if response.Code != http.StatusOK {
		t.Fatalf("GET /healthz status = %d", response.Code)
	}
	if !strings.Contains(response.Body.String(), `"status":"ok"`) {
		t.Fatalf("unexpected health response: %s", response.Body.String())
	}
}

func newTestAppHandler(t *testing.T, registryURL string) http.Handler {
	t.Helper()
	return appHandler(serverConfig{
		Listen:        ":0",
		Port:          "0",
		RegistryURL:   registryURL,
		DeleteEnabled: false,
	})
}
