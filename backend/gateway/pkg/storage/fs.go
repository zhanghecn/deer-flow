package storage

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

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

// ResolveBaseDir resolves a relative OPENAGENTS_HOME-style path against the
// project root when running from within the repository.
func ResolveBaseDir(baseDir string) string {
	if strings.TrimSpace(baseDir) == "" {
		baseDir = ".openagents"
	}
	if filepath.IsAbs(baseDir) {
		return filepath.Clean(baseDir)
	}

	if root, ok := detectProjectRoot(); ok {
		return filepath.Join(root, baseDir)
	}

	cwd, err := os.Getwd()
	if err != nil {
		return filepath.Clean(baseDir)
	}
	return filepath.Join(cwd, baseDir)
}

// AgentDir returns the directory for an agent: {baseDir}/agents/{status}/{name}/
func (f *FS) AgentDir(name, status string) string {
	return filepath.Join(f.baseDir, "agents", status, name)
}

// AgentConfigRef returns the relative reference path for an agent config manifest.
func (f *FS) AgentConfigRef(name, status string) string {
	return filepath.ToSlash(filepath.Join("agents", status, name, "config.yaml"))
}

// AgentSkillsDir returns the directory containing copied skills for an agent.
func (f *FS) AgentSkillsDir(name, status string) string {
	return filepath.Join(f.AgentDir(name, status), "skills")
}

// AgentSubagentsPath returns the structured subagents manifest path for an agent.
func (f *FS) AgentSubagentsPath(name, status string) string {
	return filepath.Join(f.AgentDir(name, status), "subagents.yaml")
}

// SkillsDir returns the root directory for all global skills.
func (f *FS) SkillsDir() string {
	return filepath.Join(f.baseDir, "skills")
}

func (f *FS) StoreDevSkillsDir() string {
	return filepath.Join(f.SkillsDir(), "store", "dev")
}

func (f *FS) StoreProdSkillsDir() string {
	return filepath.Join(f.SkillsDir(), "store", "prod")
}

// GlobalSkillDir returns the directory for a global skill.
func (f *FS) GlobalSkillDir(scope, skillName string) string {
	return filepath.Join(f.SkillsDir(), filepath.FromSlash(scope), skillName)
}

// ResolveRef resolves a relative storage reference against the gateway base dir.
func (f *FS) ResolveRef(ref string) string {
	if filepath.IsAbs(ref) {
		return ref
	}
	clean := filepath.Clean(filepath.FromSlash(ref))
	skillsPrefix := "skills" + string(filepath.Separator)
	if clean == "skills" {
		return f.SkillsDir()
	}
	if strings.HasPrefix(clean, skillsPrefix) {
		return filepath.Join(f.SkillsDir(), strings.TrimPrefix(clean, skillsPrefix))
	}
	return filepath.Join(f.baseDir, clean)
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

// WriteAgentSubagentsFile writes the structured subagents manifest for an agent.
func (f *FS) WriteAgentSubagentsFile(name, status string, payload map[string]interface{}) error {
	dir := f.AgentDir(name, status)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("mkdir agent: %w", err)
	}
	data, err := yaml.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal subagents: %w", err)
	}
	if err := os.WriteFile(f.AgentSubagentsPath(name, status), data, 0o644); err != nil {
		return fmt.Errorf("write subagents.yaml: %w", err)
	}
	return nil
}

// DeleteAgentSubagentsFile removes the structured subagents manifest for an agent.
func (f *FS) DeleteAgentSubagentsFile(name, status string) error {
	err := os.Remove(f.AgentSubagentsPath(name, status))
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

// ReadTextRef reads a UTF-8 text file from a storage reference.
func (f *FS) ReadTextRef(ref string) (string, error) {
	data, err := os.ReadFile(f.ResolveRef(ref))
	if err != nil {
		return "", err
	}
	return string(data), nil
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

// DeleteAgentSkillsDir removes the copied skills directory for an agent.
func (f *FS) DeleteAgentSkillsDir(name, status string) error {
	return os.RemoveAll(f.AgentSkillsDir(name, status))
}

// DeleteThreadDir removes all persisted files for a thread.
func (f *FS) DeleteThreadDir(threadID string) error {
	return os.RemoveAll(f.ThreadDir(threadID))
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
	return nil
}

func detectProjectRoot() (string, bool) {
	cwd, err := os.Getwd()
	if err != nil {
		return "", false
	}
	for dir := filepath.Clean(cwd); ; {
		if looksLikeProjectRoot(dir) {
			return dir, true
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return "", false
}

func looksLikeProjectRoot(dir string) bool {
	openAgentsDir := filepath.Join(dir, ".openagents")
	skillsDir := filepath.Join(openAgentsDir, "skills")
	agentsDir := filepath.Join(dir, "backend", "agents")

	openAgentsInfo, err := os.Stat(openAgentsDir)
	if err != nil || !openAgentsInfo.IsDir() {
		return false
	}
	skillsInfo, err := os.Stat(skillsDir)
	if err != nil || !skillsInfo.IsDir() {
		return false
	}
	agentsInfo, err := os.Stat(agentsDir)
	if err != nil || !agentsInfo.IsDir() {
		return false
	}
	return true
}
