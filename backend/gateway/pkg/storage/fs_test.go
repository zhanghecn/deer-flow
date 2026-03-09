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

func TestResolveRefRoutesSkillRefsToSharedSkillsRoot(t *testing.T) {
	t.Parallel()

	projectDir := t.TempDir()
	baseDir := filepath.Join(projectDir, ".openagents")
	skillsDir := filepath.Join(projectDir, "skills", "public", "research")
	if err := os.MkdirAll(skillsDir, 0755); err != nil {
		t.Fatalf("mkdir skills dir: %v", err)
	}

	fs := NewFS(baseDir)

	got := fs.ResolveRef("skills/public/research/SKILL.md")
	want := filepath.Join(projectDir, "skills", "public", "research", "SKILL.md")
	if got != want {
		t.Fatalf("ResolveRef() = %q, want %q", got, want)
	}
}

func TestGlobalSkillDirUsesSharedSkillsArchive(t *testing.T) {
	t.Parallel()

	projectDir := t.TempDir()
	baseDir := filepath.Join(projectDir, ".openagents")
	if err := os.MkdirAll(filepath.Join(projectDir, "skills"), 0755); err != nil {
		t.Fatalf("mkdir shared skills root: %v", err)
	}

	fs := NewFS(baseDir)

	got := fs.GlobalSkillDir("custom", "data-analysis")
	want := filepath.Join(projectDir, "skills", "custom", "data-analysis")
	if got != want {
		t.Fatalf("GlobalSkillDir() = %q, want %q", got, want)
	}
}

func TestSharedSkillsDirIgnoresNestedOpenAgentsSkillsDir(t *testing.T) {
	t.Parallel()

	projectDir := t.TempDir()
	baseDir := filepath.Join(projectDir, ".openagents")
	if err := os.MkdirAll(filepath.Join(baseDir, "skills", "public"), 0755); err != nil {
		t.Fatalf("mkdir nested openagents skills: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(projectDir, "skills", "public"), 0755); err != nil {
		t.Fatalf("mkdir shared skills root: %v", err)
	}

	fs := NewFS(baseDir)

	got := fs.SharedSkillsDir()
	want := filepath.Join(projectDir, "skills")
	if got != want {
		t.Fatalf("SharedSkillsDir() = %q, want %q", got, want)
	}
}

func TestResolveBaseDirUsesProjectRootForRelativePaths(t *testing.T) {
	projectDir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(projectDir, "skills"), 0755); err != nil {
		t.Fatalf("mkdir skills root: %v", err)
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
