package storage

import (
	"fmt"
	"os"
	"path/filepath"

	"gopkg.in/yaml.v3"
)

// FS handles filesystem operations for agent/skill synchronization.
type FS struct {
	baseDir string
}

func NewFS(baseDir string) *FS {
	return &FS{baseDir: baseDir}
}

func (f *FS) BaseDir() string {
	return f.baseDir
}

// AgentDir returns the directory for an agent: {baseDir}/agents/{status}/{name}/
func (f *FS) AgentDir(name, status string) string {
	return filepath.Join(f.baseDir, "agents", status, name)
}

// SkillDir returns the directory for a skill within an agent.
func (f *FS) AgentSkillDir(agentName, status, skillName string) string {
	return filepath.Join(f.AgentDir(agentName, status), "skills", skillName)
}

// GlobalSkillDir returns the directory for a global skill.
func (f *FS) GlobalSkillDir(category, skillName string) string {
	return filepath.Join(f.baseDir, "skills", category, skillName)
}

// UserDir returns the directory for a user's data.
func (f *FS) UserDir(userID string) string {
	return filepath.Join(f.baseDir, "users", userID)
}

// ThreadDir returns the directory for a thread's runtime data.
func (f *FS) ThreadDir(threadID string) string {
	return filepath.Join(f.baseDir, "threads", threadID)
}

// ThreadUserDataDir returns the user-data directory within a thread.
func (f *FS) ThreadUserDataDir(threadID string) string {
	return filepath.Join(f.ThreadDir(threadID), "user-data")
}

// WriteAgentFiles writes AGENTS.md and config.yaml for an agent.
func (f *FS) WriteAgentFiles(name, status, agentsMD string, config map[string]interface{}) error {
	dir := f.AgentDir(name, status)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("mkdir agent: %w", err)
	}

	// Write AGENTS.md
	if err := os.WriteFile(filepath.Join(dir, "AGENTS.md"), []byte(agentsMD), 0644); err != nil {
		return fmt.Errorf("write AGENTS.md: %w", err)
	}

	// Write config.yaml
	if config != nil {
		data, err := yaml.Marshal(config)
		if err != nil {
			return fmt.Errorf("marshal config: %w", err)
		}
		if err := os.WriteFile(filepath.Join(dir, "config.yaml"), data, 0644); err != nil {
			return fmt.Errorf("write config.yaml: %w", err)
		}
	}

	// Ensure skills/ subdirectory
	_ = os.MkdirAll(filepath.Join(dir, "skills"), 0755)

	return nil
}

// WriteSkillFile writes SKILL.md for a skill within an agent directory.
func (f *FS) WriteAgentSkillFile(agentName, status, skillName, skillMD string) error {
	dir := f.AgentSkillDir(agentName, status, skillName)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("mkdir skill: %w", err)
	}
	return os.WriteFile(filepath.Join(dir, "SKILL.md"), []byte(skillMD), 0644)
}

// WriteGlobalSkillFile writes a global SKILL.md.
func (f *FS) WriteGlobalSkillFile(category, skillName, skillMD string) error {
	dir := f.GlobalSkillDir(category, skillName)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("mkdir global skill: %w", err)
	}
	return os.WriteFile(filepath.Join(dir, "SKILL.md"), []byte(skillMD), 0644)
}

// DeleteAgentDir removes an agent directory.
func (f *FS) DeleteAgentDir(name, status string) error {
	return os.RemoveAll(f.AgentDir(name, status))
}

// CopyDir copies src directory to dst recursively.
func (f *FS) CopyDir(src, dst string) error {
	return filepath.Walk(src, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)

		if info.IsDir() {
			return os.MkdirAll(target, info.Mode())
		}

		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		return os.WriteFile(target, data, info.Mode())
	})
}

// EnsureThreadDirs creates the thread user-data subdirectories.
func (f *FS) EnsureThreadDirs(threadID string) error {
	base := f.ThreadUserDataDir(threadID)
	for _, sub := range []string{"workspace", "uploads", "outputs"} {
		if err := os.MkdirAll(filepath.Join(base, sub), 0755); err != nil {
			return err
		}
	}
	return nil
}

// EnsureUserDir creates the user directory with default files.
func (f *FS) EnsureUserDir(userID string) error {
	dir := f.UserDir(userID)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	// Create empty memory.json if not exists
	memFile := filepath.Join(dir, "memory.json")
	if _, err := os.Stat(memFile); os.IsNotExist(err) {
		_ = os.WriteFile(memFile, []byte("{}"), 0644)
	}
	return nil
}
