package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"io"
	"strings"
	"testing"
)

func TestMakeLayerProducesDeterministicValidArchive(t *testing.T) {
	spec := imageSpec{
		Repository:   "circular/registry-ui",
		Tag:          "v1.4.2",
		Architecture: "amd64",
		Version:      "v1.4.2",
	}
	first, firstDiffID, err := makeLayer(spec)
	if err != nil {
		t.Fatal(err)
	}
	second, secondDiffID, err := makeLayer(spec)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(first, second) || firstDiffID != secondDiffID {
		t.Fatal("layer output is not deterministic")
	}

	zr, err := gzip.NewReader(bytes.NewReader(first))
	if err != nil {
		t.Fatal(err)
	}
	defer zr.Close()
	tr := tar.NewReader(zr)
	header, err := tr.Next()
	if err != nil {
		t.Fatal(err)
	}
	if header.Name != "fixture.txt" {
		t.Fatalf("archive entry = %q, want fixture.txt", header.Name)
	}
	body, err := io.ReadAll(tr)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(body), "repository=circular/registry-ui") {
		t.Fatalf("unexpected fixture body: %q", body)
	}
}

func TestRepositoryPathNormalizesOuterSlashes(t *testing.T) {
	if got, want := repositoryPath("/circular/registry-ui/"), "circular/registry-ui"; got != want {
		t.Fatalf("repositoryPath() = %q, want %q", got, want)
	}
}
