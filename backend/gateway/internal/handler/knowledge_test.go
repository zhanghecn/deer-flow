package handler

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/openagents/gateway/internal/knowledgeasset"
	"github.com/openagents/gateway/internal/repository"
)

func TestDebugCanonicalStorageRef(t *testing.T) {
	t.Run("prefers canonical artifact", func(t *testing.T) {
		canonical := "knowledge/base/doc/canonical.md"
		markdown := "knowledge/base/doc/companion.md"
		source := "knowledge/base/doc/source.docx"

		got := debugCanonicalStorageRef(repository.KnowledgeDocumentRecord{
			FileKind:             "docx",
			CanonicalStoragePath: &canonical,
			MarkdownStoragePath:  &markdown,
			SourceStoragePath:    &source,
		})
		if got != canonical {
			t.Fatalf("debugCanonicalStorageRef() = %v, want %q", got, canonical)
		}
	})

	t.Run("falls back to markdown companion for binary document", func(t *testing.T) {
		markdown := "knowledge/base/doc/companion.md"
		source := "knowledge/base/doc/source.pptx"

		got := debugCanonicalStorageRef(repository.KnowledgeDocumentRecord{
			FileKind:            "pptx",
			MarkdownStoragePath: &markdown,
			SourceStoragePath:   &source,
		})
		if got != markdown {
			t.Fatalf("debugCanonicalStorageRef() = %v, want %q", got, markdown)
		}
	})

	t.Run("does not treat binary source as canonical fallback", func(t *testing.T) {
		source := "knowledge/base/doc/source.xlsx"

		got := debugCanonicalStorageRef(repository.KnowledgeDocumentRecord{
			FileKind:          "xlsx",
			SourceStoragePath: &source,
		})
		if got != "" {
			t.Fatalf("debugCanonicalStorageRef() = %q, want empty", got)
		}
	})

	t.Run("allows markdown source fallback", func(t *testing.T) {
		source := "knowledge/base/doc/source.md"

		got := debugCanonicalStorageRef(repository.KnowledgeDocumentRecord{
			FileKind:          "markdown",
			SourceStoragePath: &source,
		})
		if got != source {
			t.Fatalf("debugCanonicalStorageRef() = %v, want %q", got, source)
		}
	})
}

func TestResolveKnowledgeAssetRef(t *testing.T) {
	store, err := knowledgeasset.New(filepath.Join(t.TempDir(), ".openagents"))
	if err != nil {
		t.Fatalf("knowledgeasset.New() error = %v", err)
	}

	t.Run("resolves asset relative to knowledge document directory", func(t *testing.T) {
		got, err := store.ResolvePackageRelativeRef(
			"knowledge/base/doc/canonical.md",
			"images/cover.png",
		)
		if err != nil {
			t.Fatalf("ResolvePackageRelativeRef() error = %v", err)
		}
		want := "knowledge/base/doc/images/cover.png"
		if got != want {
			t.Fatalf("ResolvePackageRelativeRef() = %q, want %q", got, want)
		}
	})

	t.Run("resolves asset relative to document package root for nested storage refs", func(t *testing.T) {
		got, err := store.ResolvePackageRelativeRef(
			"knowledge/base/doc/canonical/canonical.md",
			"assets/pages/page-0012.png",
		)
		if err != nil {
			t.Fatalf("ResolvePackageRelativeRef() error = %v", err)
		}
		want := "knowledge/base/doc/assets/pages/page-0012.png"
		if got != want {
			t.Fatalf("ResolvePackageRelativeRef() = %q, want %q", got, want)
		}
	})

	t.Run("rejects escaping paths", func(t *testing.T) {
		_, err := store.ResolvePackageRelativeRef(
			"knowledge/base/doc/canonical.md",
			"../secret.txt",
		)
		if err == nil {
			t.Fatal("ResolvePackageRelativeRef() error = nil, want rejection")
		}
	})
}

func TestCopyMarkdownReferencedAssets(t *testing.T) {
	t.Run("copies relative markdown image assets into the knowledge package", func(t *testing.T) {
		sourceDir := filepath.Join(t.TempDir(), "uploads")
		if err := os.MkdirAll(filepath.Join(sourceDir, "images"), 0755); err != nil {
			t.Fatalf("mkdir source asset dir: %v", err)
		}
		sourceMarkdownPath := filepath.Join(sourceDir, "demo.md")
		sourceImagePath := filepath.Join(sourceDir, "images", "chart.png")
		if err := os.WriteFile(sourceMarkdownPath, []byte("# Demo\n\n![](images/chart.png)\n"), 0644); err != nil {
			t.Fatalf("write source markdown: %v", err)
		}
		if err := os.WriteFile(sourceImagePath, []byte("png-bytes"), 0644); err != nil {
			t.Fatalf("write source image: %v", err)
		}

		targetMarkdownPath := filepath.Join(t.TempDir(), "knowledge", "source", "demo.md")
		if err := os.MkdirAll(filepath.Dir(targetMarkdownPath), 0755); err != nil {
			t.Fatalf("mkdir target markdown dir: %v", err)
		}
		if err := os.WriteFile(targetMarkdownPath, []byte("# Demo\n"), 0644); err != nil {
			t.Fatalf("write target markdown: %v", err)
		}

		if err := copyMarkdownReferencedAssets(sourceMarkdownPath, targetMarkdownPath); err != nil {
			t.Fatalf("copyMarkdownReferencedAssets() error = %v", err)
		}

		targetImagePath := filepath.Join(filepath.Dir(targetMarkdownPath), "images", "chart.png")
		got, err := os.ReadFile(targetImagePath)
		if err != nil {
			t.Fatalf("read copied image: %v", err)
		}
		if string(got) != "png-bytes" {
			t.Fatalf("copied image payload = %q, want %q", got, "png-bytes")
		}
	})

	t.Run("ignores remote and escaping image refs", func(t *testing.T) {
		refs := collectMarkdownRelativeAssetRefs(strings.Join([]string{
			"![](images/chart.png)",
			"![](https://example.com/chart.png)",
			`<img src="../secret.png" />`,
			"![](/mnt/user-data/outputs/test.png)",
		}, "\n"))

		if len(refs) != 1 {
			t.Fatalf("collectMarkdownRelativeAssetRefs() len = %d, want 1", len(refs))
		}
		if refs[0] != "images/chart.png" {
			t.Fatalf("collectMarkdownRelativeAssetRefs()[0] = %q, want %q", refs[0], "images/chart.png")
		}
	})
}

func TestFilterKnowledgeBasesForReadyDocuments(t *testing.T) {
	readyBase := repository.KnowledgeBaseRecord{
		ID: "base-ready",
		Documents: []repository.KnowledgeDocumentRecord{
			{ID: "doc-ready", Status: "ready"},
			{ID: "doc-error", Status: "error"},
		},
	}
	errorOnlyBase := repository.KnowledgeBaseRecord{
		ID: "base-error",
		Documents: []repository.KnowledgeDocumentRecord{
			{ID: "doc-processing", Status: "processing"},
		},
	}

	filtered := filterKnowledgeBasesForReadyDocuments(
		[]repository.KnowledgeBaseRecord{readyBase, errorOnlyBase},
	)

	if len(filtered) != 1 {
		t.Fatalf("filterKnowledgeBasesForReadyDocuments() len = %d, want 1", len(filtered))
	}
	if filtered[0].ID != "base-ready" {
		t.Fatalf("filterKnowledgeBasesForReadyDocuments()[0].ID = %q, want %q", filtered[0].ID, "base-ready")
	}
	if len(filtered[0].Documents) != 1 {
		t.Fatalf("filterKnowledgeBasesForReadyDocuments()[0].Documents len = %d, want 1", len(filtered[0].Documents))
	}
	if filtered[0].Documents[0].ID != "doc-ready" {
		t.Fatalf("filterKnowledgeBasesForReadyDocuments()[0].Documents[0].ID = %q, want %q", filtered[0].Documents[0].ID, "doc-ready")
	}
}
