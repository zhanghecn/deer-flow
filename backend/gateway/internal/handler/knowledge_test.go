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
	t.Setenv("KNOWLEDGE_OBJECT_STORE", "filesystem")
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

func TestStorageRefRejectsPathsOutsideKnowledgeBaseRoot(t *testing.T) {
	baseDir := filepath.Join(t.TempDir(), ".openagents")

	_, err := storageRef(baseDir, filepath.Join(t.TempDir(), "outside.pdf"))
	if err == nil {
		t.Fatal("storageRef() error = nil, want rejection for path outside base dir")
	}
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
			{ID: "doc-ready-degraded", Status: "ready_degraded"},
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
	if len(filtered[0].Documents) != 2 {
		t.Fatalf("filterKnowledgeBasesForReadyDocuments()[0].Documents len = %d, want 2", len(filtered[0].Documents))
	}
	if filtered[0].Documents[0].ID != "doc-ready" {
		t.Fatalf("filterKnowledgeBasesForReadyDocuments()[0].Documents[0].ID = %q, want %q", filtered[0].Documents[0].ID, "doc-ready")
	}
	if filtered[0].Documents[1].ID != "doc-ready-degraded" {
		t.Fatalf(
			"filterKnowledgeBasesForReadyDocuments()[0].Documents[1].ID = %q, want %q",
			filtered[0].Documents[1].ID,
			"doc-ready-degraded",
		)
	}
}

func TestWorkspaceGraphHelpersMatchLLMWikiRelevanceSignals(t *testing.T) {
	sources := workspaceMarkdownSources("---\nsources:\n  - contract.pdf\n  - \"risk.md\"\n---\n# 合同")
	if strings.Join(sources, ",") != "contract.pdf,risk.md" {
		t.Fatalf("workspaceMarkdownSources() = %+v, want parsed source frontmatter", sources)
	}

	a := &knowledgeWorkspaceGraphRawNode{
		id:      "breach",
		label:   "违约责任",
		kind:    "concept",
		sources: []string{"contract.pdf"},
		out:     map[string]bool{"termination": true, "notice": true},
		in:      map[string]bool{},
	}
	b := &knowledgeWorkspaceGraphRawNode{
		id:      "termination",
		label:   "解除权",
		kind:    "concept",
		sources: []string{"contract.pdf"},
		out:     map[string]bool{"notice": true},
		in:      map[string]bool{"breach": true},
	}
	notice := &knowledgeWorkspaceGraphRawNode{
		id:      "notice",
		label:   "通知义务",
		kind:    "entity",
		sources: []string{"contract.pdf"},
		out:     map[string]bool{},
		in:      map[string]bool{"breach": true, "termination": true},
	}

	got := calculateWorkspaceGraphRelevance(a, b, map[string]*knowledgeWorkspaceGraphRawNode{
		"breach":      a,
		"termination": b,
		"notice":      notice,
	})

	if got <= 8.0 {
		t.Fatalf("calculateWorkspaceGraphRelevance() = %.3f, want direct/source/common-neighbor weighted score", got)
	}
}

func TestWorkspaceGraphCommunityIdsFollowSortedDisplayOrder(t *testing.T) {
	nodes := map[string]*knowledgeWorkspaceGraphRawNode{
		"a": {id: "a", label: "A", out: map[string]bool{"b": true}, in: map[string]bool{}},
		"b": {id: "b", label: "B", out: map[string]bool{"c": true}, in: map[string]bool{"a": true}},
		"c": {id: "c", label: "C", out: map[string]bool{}, in: map[string]bool{"b": true}},
		"z": {id: "z", label: "Z", out: map[string]bool{}, in: map[string]bool{}},
	}
	edges := []knowledgeWorkspaceGraphEdge{
		{Source: "a", Target: "b", Weight: 1},
		{Source: "b", Target: "c", Weight: 1},
	}

	assignments, communities := assignWorkspaceGraphCommunities(nodes, edges)

	if len(communities) != 2 {
		t.Fatalf("communities len = %d, want 2", len(communities))
	}
	if communities[0].NodeCount != 3 || communities[0].ID != 0 {
		t.Fatalf("largest community = %+v, want id 0 and 3 nodes", communities[0])
	}
	if assignments["a"] != 0 || assignments["z"] != 1 {
		t.Fatalf("assignments = %+v, want largest component assigned first", assignments)
	}
}

func TestWorkspaceGraphCommunitiesSplitWeakBridges(t *testing.T) {
	nodes := map[string]*knowledgeWorkspaceGraphRawNode{
		"a": {id: "a", label: "A", out: map[string]bool{"b": true}, in: map[string]bool{}},
		"b": {id: "b", label: "B", out: map[string]bool{"c": true}, in: map[string]bool{"a": true}},
		"c": {id: "c", label: "C", out: map[string]bool{"d": true}, in: map[string]bool{"b": true}},
		"d": {id: "d", label: "D", out: map[string]bool{}, in: map[string]bool{"c": true}},
	}
	edges := []knowledgeWorkspaceGraphEdge{
		{Source: "a", Target: "b", Weight: 10},
		{Source: "b", Target: "c", Weight: 0.1},
		{Source: "c", Target: "d", Weight: 10},
	}

	assignments, communities := assignWorkspaceGraphCommunities(nodes, edges)

	if len(communities) != 2 {
		t.Fatalf("communities len = %d, want weak bridge split into two communities", len(communities))
	}
	if assignments["a"] != assignments["b"] {
		t.Fatalf("assignments = %+v, want a/b retained as a strong pair", assignments)
	}
	if assignments["c"] != assignments["d"] {
		t.Fatalf("assignments = %+v, want c/d retained as a strong pair", assignments)
	}
	if assignments["a"] == assignments["c"] {
		t.Fatalf("assignments = %+v, want weak b/c bridge not to collapse all nodes", assignments)
	}
}
