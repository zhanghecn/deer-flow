package knowledgeasset

import (
	"path/filepath"
	"testing"
)

func TestNewRequiresExplicitBackendConfig(t *testing.T) {
	t.Setenv("KNOWLEDGE_OBJECT_STORE", "")

	_, err := New(filepath.Join(t.TempDir(), ".openagents"))
	if err == nil {
		t.Fatal("New() error = nil, want explicit backend validation")
	}
}

func TestNewRejectsLegacyBackendAliases(t *testing.T) {
	for _, backend := range []string{"fs", "local", "s3"} {
		t.Run(backend, func(t *testing.T) {
			t.Setenv("KNOWLEDGE_OBJECT_STORE", backend)
			if backend == "s3" {
				t.Setenv("KNOWLEDGE_S3_ENDPOINT", "http://localhost:9000")
				t.Setenv("KNOWLEDGE_S3_ACCESS_KEY", "zhangxuan")
				t.Setenv("KNOWLEDGE_S3_SECRET_KEY", "zhangxuan66")
				t.Setenv("KNOWLEDGE_S3_BUCKET", "knowledge")
			}

			_, err := New(filepath.Join(t.TempDir(), ".openagents"))
			if err == nil {
				t.Fatalf("New() error = nil for legacy backend alias %q", backend)
			}
		})
	}
}

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

func TestParseStorageRefRejectsAbsoluteFilesystemPaths(t *testing.T) {
	t.Setenv("KNOWLEDGE_OBJECT_STORE", "filesystem")

	store, err := New(filepath.Join(t.TempDir(), ".openagents"))
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	_, err = store.parseStorageRef("/tmp/demo.pdf")
	if err == nil {
		t.Fatal("parseStorageRef() error = nil, want rejection for absolute filesystem path")
	}
}
