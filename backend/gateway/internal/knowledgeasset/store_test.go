package knowledgeasset

import (
	"path/filepath"
	"testing"
)

func TestRefForRelativePathUsesS3SchemeWhenObjectStoreEnabled(t *testing.T) {
	t.Setenv("KNOWLEDGE_OBJECT_STORE", "minio")
	t.Setenv("KNOWLEDGE_S3_ENDPOINT", "http://localhost:9000")
	t.Setenv("KNOWLEDGE_S3_ACCESS_KEY", "zhangxuan")
	t.Setenv("KNOWLEDGE_S3_SECRET_KEY", "zhangxuan66")
	t.Setenv("KNOWLEDGE_S3_BUCKET", "knowledge")

	store, err := New(filepath.Join(t.TempDir(), ".openagents"))
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	got := store.RefForRelativePath("knowledge/users/u-1/bases/b-1/documents/d-1/source/demo.pdf")
	want := "s3://knowledge/users/u-1/bases/b-1/documents/d-1/source/demo.pdf"
	if got != want {
		t.Fatalf("RefForRelativePath() = %q, want %q", got, want)
	}
}

func TestResolvePackageRelativeRefSupportsS3StorageRefs(t *testing.T) {
	t.Setenv("KNOWLEDGE_OBJECT_STORE", "minio")
	t.Setenv("KNOWLEDGE_S3_ENDPOINT", "http://localhost:9000")
	t.Setenv("KNOWLEDGE_S3_ACCESS_KEY", "zhangxuan")
	t.Setenv("KNOWLEDGE_S3_SECRET_KEY", "zhangxuan66")
	t.Setenv("KNOWLEDGE_S3_BUCKET", "knowledge")

	store, err := New(filepath.Join(t.TempDir(), ".openagents"))
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	got, err := store.ResolvePackageRelativeRef(
		"s3://knowledge/users/u-1/bases/b-1/documents/d-1/canonical/canonical.md",
		"assets/pages/page-0003.png",
	)
	if err != nil {
		t.Fatalf("ResolvePackageRelativeRef() error = %v", err)
	}

	want := "s3://knowledge/users/u-1/bases/b-1/documents/d-1/assets/pages/page-0003.png"
	if got != want {
		t.Fatalf("ResolvePackageRelativeRef() = %q, want %q", got, want)
	}
}

func TestNormalizeObjectKeyStripsLegacyKnowledgePrefix(t *testing.T) {
	got := normalizeObjectKey("knowledge/users/u-1/bases/b-1/documents/d-1/source/demo.pdf")
	want := "users/u-1/bases/b-1/documents/d-1/source/demo.pdf"
	if got != want {
		t.Fatalf("normalizeObjectKey() = %q, want %q", got, want)
	}
}

func TestStoragePrefixesForCleanupIncludesLegacyAndNormalizedPrefixes(t *testing.T) {
	got := storagePrefixesForCleanup("knowledge/users/u-1/bases/b-1")
	want := []string{"users/u-1/bases/b-1", "knowledge/users/u-1/bases/b-1"}
	if len(got) != len(want) {
		t.Fatalf("storagePrefixesForCleanup() len = %d, want %d", len(got), len(want))
	}
	for idx := range want {
		if got[idx] != want[idx] {
			t.Fatalf("storagePrefixesForCleanup()[%d] = %q, want %q", idx, got[idx], want[idx])
		}
	}
}
