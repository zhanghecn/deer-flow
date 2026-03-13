package storage

import (
	"os"
	"path/filepath"
	"testing"
)

func TestResolveRefKeepsAgentRefsUnderBaseDir(t *testing.T) {
	t.Parallel()

	projectDir := t.TempDir()
	baseDir := filepath.Join(projectDir, ".openagents")
	fs := NewFS(baseDir)

	got := fs.ResolveRef("agents/dev/analyst/AGENTS.md")
	want := filepath.Join(baseDir, "agents", "dev", "analyst", "AGENTS.md")
	if got != want {
		t.Fatalf("ResolveRef() = %q, want %q", got, want)
	}
}

func TestResolveRefRoutesSkillRefsToOpenAgentsSkillsRoot(t *testing.T) {
	t.Parallel()

	projectDir := t.TempDir()
	baseDir := filepath.Join(projectDir, ".openagents")
	skillsDir := filepath.Join(baseDir, "skills", "shared", "research")
	if err := os.MkdirAll(skillsDir, 0755); err != nil {
		t.Fatalf("mkdir skills dir: %v", err)
	}

	fs := NewFS(baseDir)

	got := fs.ResolveRef("skills/shared/research/SKILL.md")
	want := filepath.Join(baseDir, "skills", "shared", "research", "SKILL.md")
	if got != want {
		t.Fatalf("ResolveRef() = %q, want %q", got, want)
	}
}

func TestGlobalSkillDirUsesOpenAgentsSkillsArchive(t *testing.T) {
	t.Parallel()

	projectDir := t.TempDir()
	baseDir := filepath.Join(projectDir, ".openagents")
	if err := os.MkdirAll(filepath.Join(baseDir, "skills"), 0755); err != nil {
		t.Fatalf("mkdir shared skills root: %v", err)
	}

	fs := NewFS(baseDir)

	got := fs.GlobalSkillDir("store/dev", "data-analysis")
	want := filepath.Join(baseDir, "skills", "store", "dev", "data-analysis")
	if got != want {
		t.Fatalf("GlobalSkillDir() = %q, want %q", got, want)
	}
}

func TestSharedSkillsDirUsesOpenAgentsSharedScope(t *testing.T) {
	t.Parallel()

	projectDir := t.TempDir()
	baseDir := filepath.Join(projectDir, ".openagents")
	if err := os.MkdirAll(filepath.Join(baseDir, "skills", "shared"), 0755); err != nil {
		t.Fatalf("mkdir shared skills root: %v", err)
	}

	fs := NewFS(baseDir)

	got := fs.SharedSkillsDir()
	want := filepath.Join(baseDir, "skills", "shared")
	if got != want {
		t.Fatalf("SharedSkillsDir() = %q, want %q", got, want)
	}
}

func TestResolveBaseDirUsesProjectRootForRelativePaths(t *testing.T) {
	projectDir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(projectDir, ".openagents", "skills"), 0755); err != nil {
		t.Fatalf("mkdir .openagents/skills: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(projectDir, "backend", "agents"), 0755); err != nil {
		t.Fatalf("mkdir backend/agents: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(projectDir, "backend", "gateway"), 0755); err != nil {
		t.Fatalf("mkdir backend/gateway: %v", err)
	}

	t.Chdir(filepath.Join(projectDir, "backend", "gateway"))

	got := ResolveBaseDir(".openagents")
	want := filepath.Join(projectDir, ".openagents")
	if got != want {
		t.Fatalf("ResolveBaseDir() = %q, want %q", got, want)
	}
}
