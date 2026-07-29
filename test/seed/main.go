package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path"
	"strings"
	"time"
)

const (
	ociConfigMediaType   = "application/vnd.oci.image.config.v1+json"
	ociIndexMediaType    = "application/vnd.oci.image.index.v1+json"
	ociLayerMediaType    = "application/vnd.oci.image.layer.v1.tar+gzip"
	ociManifestMediaType = "application/vnd.oci.image.manifest.v1+json"
)

type descriptor struct {
	MediaType string            `json:"mediaType"`
	Digest    string            `json:"digest"`
	Size      int64             `json:"size"`
	Platform  *platform         `json:"platform,omitempty"`
	Ann       map[string]string `json:"annotations,omitempty"`
}

type platform struct {
	Architecture string `json:"architecture"`
	OS           string `json:"os"`
	Variant      string `json:"variant,omitempty"`
}

type imageManifest struct {
	SchemaVersion int               `json:"schemaVersion"`
	MediaType     string            `json:"mediaType"`
	Config        descriptor        `json:"config"`
	Layers        []descriptor      `json:"layers"`
	Ann           map[string]string `json:"annotations,omitempty"`
}

type imageIndex struct {
	SchemaVersion int               `json:"schemaVersion"`
	MediaType     string            `json:"mediaType"`
	Manifests     []descriptor      `json:"manifests"`
	Ann           map[string]string `json:"annotations,omitempty"`
}

type client struct {
	base *url.URL
	http *http.Client
}

type imageSpec struct {
	Repository   string
	Tag          string
	Architecture string
	Variant      string
	Version      string
	Created      string
	Command      []string
}

func main() {
	rawURL := strings.TrimSpace(os.Getenv("REGISTRY_URL"))
	if rawURL == "" {
		rawURL = "http://registry:5000"
	}
	base, err := url.Parse(strings.TrimRight(rawURL, "/"))
	if err != nil || base.Scheme == "" || base.Host == "" {
		log.Fatalf("invalid REGISTRY_URL %q", rawURL)
	}

	c := &client{
		base: base,
		http: &http.Client{Timeout: 15 * time.Second},
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	if err := c.wait(ctx); err != nil {
		log.Fatal(err)
	}
	if err := c.seed(ctx); err != nil {
		log.Fatal(err)
	}
	log.Printf("published deterministic OCI fixtures to %s", base.Redacted())
}

func (c *client) wait(ctx context.Context) error {
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()

	for {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.endpoint("/v2/"), nil)
		if err == nil {
			resp, requestErr := c.http.Do(req)
			if requestErr == nil {
				_, _ = io.Copy(io.Discard, resp.Body)
				_ = resp.Body.Close()
				if resp.StatusCode >= 200 && resp.StatusCode < 300 {
					return nil
				}
			}
		}

		select {
		case <-ctx.Done():
			return errors.New("timed out waiting for the test registry")
		case <-ticker.C:
		}
	}
}

func (c *client) seed(ctx context.Context) error {
	amd64, err := c.publishImage(ctx, imageSpec{
		Repository:   "circular/registry-ui",
		Tag:          "v1.4.2",
		Architecture: "amd64",
		Version:      "v1.4.2",
		Created:      "2026-07-29T08:42:00Z",
		Command:      []string{"/registry-ui"},
	})
	if err != nil {
		return err
	}
	arm64, err := c.publishImage(ctx, imageSpec{
		Repository:   "circular/registry-ui",
		Tag:          "v1.4.2",
		Architecture: "arm64",
		Variant:      "v8",
		Version:      "v1.4.2",
		Created:      "2026-07-29T08:42:00Z",
		Command:      []string{"/registry-ui"},
	})
	if err != nil {
		return err
	}
	index := imageIndex{
		SchemaVersion: 2,
		MediaType:     ociIndexMediaType,
		Manifests:     []descriptor{amd64, arm64},
		Ann: map[string]string{
			"org.opencontainers.image.title":   "Registry UI",
			"org.opencontainers.image.version": "v1.4.2",
		},
	}
	indexBody, err := json.Marshal(index)
	if err != nil {
		return err
	}
	for _, tag := range []string{"v1.4.2", "latest"} {
		if err := c.putManifest(ctx, "circular/registry-ui", tag, ociIndexMediaType, indexBody); err != nil {
			return err
		}
	}

	fixtures := []imageSpec{
		{
			Repository:   "circular/fast-api",
			Tag:          "v2.7.0",
			Architecture: "amd64",
			Version:      "v2.7.0",
			Created:      "2026-07-28T17:03:00Z",
			Command:      []string{"/fast-api"},
		},
		{
			Repository:   "infrastructure/nginx",
			Tag:          "1.29-alpine",
			Architecture: "amd64",
			Version:      "1.29-alpine",
			Created:      "2026-07-27T12:15:00Z",
			Command:      []string{"nginx", "-g", "daemon off;"},
		},
		{
			Repository:   "data/clickhouse",
			Tag:          "25.8",
			Architecture: "amd64",
			Version:      "25.8",
			Created:      "2026-07-26T09:30:00Z",
			Command:      []string{"/usr/bin/clickhouse-server"},
		},
	}
	for _, fixture := range fixtures {
		desc, publishErr := c.publishImage(ctx, fixture)
		if publishErr != nil {
			return publishErr
		}
		body, readErr := c.manifestBody(ctx, fixture.Repository, desc.Digest)
		if readErr != nil {
			return readErr
		}
		if err := c.putManifest(ctx, fixture.Repository, fixture.Tag, ociManifestMediaType, body); err != nil {
			return err
		}
	}
	return nil
}

func (c *client) publishImage(ctx context.Context, spec imageSpec) (descriptor, error) {
	layer, diffID, err := makeLayer(spec)
	if err != nil {
		return descriptor{}, err
	}
	layerDesc := descriptor{
		MediaType: ociLayerMediaType,
		Digest:    digest(layer),
		Size:      int64(len(layer)),
	}

	config := map[string]any{
		"created":      spec.Created,
		"architecture": spec.Architecture,
		"os":           "linux",
		"variant":      spec.Variant,
		"author":       "Circular",
		"config": map[string]any{
			"User":       "65532:65532",
			"Env":        []string{"PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", "PORT=8080", "VERSION=" + spec.Version},
			"Entrypoint": spec.Command,
			"WorkingDir": "/",
			"Labels": map[string]string{
				"org.opencontainers.image.source":  "https://github.com/Circular-fi/registry-ui",
				"org.opencontainers.image.version": spec.Version,
			},
			"ExposedPorts": map[string]any{"8080/tcp": map[string]any{}},
			"StopSignal":   "SIGTERM",
			"Healthcheck": map[string]any{
				"Test":        []string{"CMD", spec.Command[0], "health", "--quiet"},
				"Interval":    int64(30 * time.Second),
				"Timeout":     int64(3 * time.Second),
				"StartPeriod": int64(5 * time.Second),
				"Retries":     3,
			},
		},
		"rootfs": map[string]any{
			"type":     "layers",
			"diff_ids": []string{diffID},
		},
		"history": []map[string]any{
			{
				"created":     spec.Created,
				"created_by":  "ARG VERSION=" + spec.Version,
				"empty_layer": true,
			},
			{
				"created":     spec.Created,
				"created_by":  "ENV PORT=8080",
				"empty_layer": true,
			},
			{
				"created":    spec.Created,
				"created_by": "COPY /out/rootfs/ / # buildkit",
				"comment":    "registry-ui integration fixture",
			},
			{
				"created":     spec.Created,
				"created_by":  "USER 65532:65532",
				"empty_layer": true,
			},
			{
				"created":     spec.Created,
				"created_by":  "WORKDIR /",
				"empty_layer": true,
			},
			{
				"created":     spec.Created,
				"created_by":  "EXPOSE map[8080/tcp:{}]",
				"empty_layer": true,
			},
			{
				"created":     spec.Created,
				"created_by":  "STOPSIGNAL SIGTERM",
				"empty_layer": true,
			},
			{
				"created":     spec.Created,
				"created_by":  "ENTRYPOINT [\"" + strings.Join(spec.Command, "\",\"") + "\"]",
				"empty_layer": true,
			},
			{
				"created":     spec.Created,
				"created_by":  "HEALTHCHECK &{[\"CMD\" \"" + spec.Command[0] + "\" \"health\" \"--quiet\"] \"30s\" \"3s\" \"5s\" \"0s\" '\\x03'}",
				"empty_layer": true,
			},
		},
	}
	configBody, err := json.Marshal(config)
	if err != nil {
		return descriptor{}, err
	}
	configDesc := descriptor{
		MediaType: ociConfigMediaType,
		Digest:    digest(configBody),
		Size:      int64(len(configBody)),
	}

	if err := c.putBlob(ctx, spec.Repository, configDesc.Digest, configBody); err != nil {
		return descriptor{}, err
	}
	if err := c.putBlob(ctx, spec.Repository, layerDesc.Digest, layer); err != nil {
		return descriptor{}, err
	}

	manifest := imageManifest{
		SchemaVersion: 2,
		MediaType:     ociManifestMediaType,
		Config:        configDesc,
		Layers:        []descriptor{layerDesc},
		Ann: map[string]string{
			"org.opencontainers.image.created": spec.Created,
			"org.opencontainers.image.title":   spec.Repository,
			"org.opencontainers.image.version": spec.Version,
		},
	}
	body, err := json.Marshal(manifest)
	if err != nil {
		return descriptor{}, err
	}
	manifestDesc := descriptor{
		MediaType: ociManifestMediaType,
		Digest:    digest(body),
		Size:      int64(len(body)),
		Platform: &platform{
			Architecture: spec.Architecture,
			OS:           "linux",
			Variant:      spec.Variant,
		},
	}
	if err := c.putManifest(ctx, spec.Repository, manifestDesc.Digest, ociManifestMediaType, body); err != nil {
		return descriptor{}, err
	}
	return manifestDesc, nil
}

func (c *client) putBlob(ctx context.Context, repository, blobDigest string, body []byte) error {
	head, err := http.NewRequestWithContext(ctx, http.MethodHead, c.endpoint("/v2/"+repositoryPath(repository)+"/blobs/"+blobDigest), nil)
	if err != nil {
		return err
	}
	resp, err := c.http.Do(head)
	if err == nil {
		_, _ = io.Copy(io.Discard, resp.Body)
		_ = resp.Body.Close()
		if resp.StatusCode == http.StatusOK {
			return nil
		}
	}

	start, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint("/v2/"+repositoryPath(repository)+"/blobs/uploads/"), nil)
	if err != nil {
		return err
	}
	resp, err = c.http.Do(start)
	if err != nil {
		return err
	}
	_, _ = io.Copy(io.Discard, resp.Body)
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusAccepted {
		return fmt.Errorf("start blob upload for %s: %s", repository, resp.Status)
	}

	location, err := c.resolveLocation(resp.Header.Get("Location"))
	if err != nil {
		return err
	}
	query := location.Query()
	query.Set("digest", blobDigest)
	location.RawQuery = query.Encode()

	put, err := http.NewRequestWithContext(ctx, http.MethodPut, location.String(), bytes.NewReader(body))
	if err != nil {
		return err
	}
	put.Header.Set("Content-Type", "application/octet-stream")
	resp, err = c.http.Do(put)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)
	if resp.StatusCode != http.StatusCreated {
		return fmt.Errorf("complete blob upload for %s: %s", repository, resp.Status)
	}
	return nil
}

func (c *client) putManifest(ctx context.Context, repository, reference, mediaType string, body []byte) error {
	target := c.endpoint("/v2/" + repositoryPath(repository) + "/manifests/" + reference)
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, target, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", mediaType)
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)
	if resp.StatusCode != http.StatusCreated {
		return fmt.Errorf("publish manifest %s:%s: %s", repository, reference, resp.Status)
	}
	return nil
}

func (c *client) manifestBody(ctx context.Context, repository, manifestDigest string) ([]byte, error) {
	target := c.endpoint("/v2/" + repositoryPath(repository) + "/manifests/" + manifestDigest)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", ociManifestMediaType)
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, resp.Body)
		return nil, fmt.Errorf("read manifest %s@%s: %s", repository, manifestDigest, resp.Status)
	}
	return io.ReadAll(io.LimitReader(resp.Body, 4<<20))
}

func (c *client) endpoint(requestPath string) string {
	target := *c.base
	target.Path = path.Join(strings.TrimSuffix(c.base.Path, "/"), requestPath)
	if strings.HasSuffix(requestPath, "/") && !strings.HasSuffix(target.Path, "/") {
		target.Path += "/"
	}
	return target.String()
}

func (c *client) resolveLocation(raw string) (*url.URL, error) {
	location, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || raw == "" {
		return nil, errors.New("registry returned an invalid upload location")
	}
	return c.base.ResolveReference(location), nil
}

func repositoryPath(repository string) string {
	return strings.Trim(repository, "/")
}

func makeLayer(spec imageSpec) ([]byte, string, error) {
	var plain bytes.Buffer
	tw := tar.NewWriter(&plain)
	content := []byte(fmt.Sprintf(
		"repository=%s\ntag=%s\narchitecture=%s\nversion=%s\n",
		spec.Repository,
		spec.Tag,
		spec.Architecture,
		spec.Version,
	))
	header := &tar.Header{
		Name:    "fixture.txt",
		Mode:    0o644,
		Size:    int64(len(content)),
		ModTime: time.Unix(0, 0).UTC(),
	}
	if err := tw.WriteHeader(header); err != nil {
		return nil, "", err
	}
	if _, err := tw.Write(content); err != nil {
		return nil, "", err
	}
	if err := tw.Close(); err != nil {
		return nil, "", err
	}

	var compressed bytes.Buffer
	zw := gzip.NewWriter(&compressed)
	zw.Header.ModTime = time.Unix(0, 0).UTC()
	zw.Header.OS = 255
	if _, err := zw.Write(plain.Bytes()); err != nil {
		return nil, "", err
	}
	if err := zw.Close(); err != nil {
		return nil, "", err
	}
	return compressed.Bytes(), digest(plain.Bytes()), nil
}

func digest(body []byte) string {
	sum := sha256.Sum256(body)
	return "sha256:" + hex.EncodeToString(sum[:])
}
