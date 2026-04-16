package storage

import (
	"fmt"
	"os"
	"path"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

// FS handles filesystem operations for agent/skill synchronization.
type FS struct {
	baseDir string
}

const builtinLeadAgentName = "lead_agent"

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

func isBuiltinAgentName(name string) bool {
	return strings.EqualFold(strings.TrimSpace(name), builtinLeadAgentName)
}

func (f *FS) SystemDir() string {
	return filepath.Join(f.baseDir, "system")
}

func (f *FS) CustomDir() string {
	return filepath.Join(f.baseDir, "custom")
}

func (f *FS) SystemAgentsDir(status string) string {
	return filepath.Join(f.SystemDir(), "agents", status)
}

func (f *FS) CustomAgentsDir(status string) string {
	return filepath.Join(f.CustomDir(), "agents", status)
}

func (f *FS) SystemAgentDir(name, status string) string {
	return filepath.Join(f.SystemAgentsDir(status), name)
}

func (f *FS) CustomAgentDir(name, status string) string {
	return filepath.Join(f.CustomAgentsDir(status), name)
}

// AgentDir returns the canonical authored archive directory for an agent.
//
// Reserved built-ins live under `system/agents/...`; writable user-authored
// agents live under `custom/agents/...`.
func (f *FS) AgentDir(name, status string) string {
	if isBuiltinAgentName(name) {
		return f.SystemAgentDir(name, status)
	}
	return f.CustomAgentDir(name, status)
}

// AgentConfigRef returns the relative reference path for an agent config manifest.
func (f *FS) AgentConfigRef(name, status string) string {
	if isBuiltinAgentName(name) {
		return filepath.ToSlash(filepath.Join("system", "agents", status, name, "config.yaml"))
	}
	return filepath.ToSlash(filepath.Join("custom", "agents", status, name, "config.yaml"))
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

func (f *FS) SystemSkillsDir() string {
	return filepath.Join(f.SystemDir(), "skills")
}

func (f *FS) CustomSkillsDir() string {
	return filepath.Join(f.CustomDir(), "skills")
}

func (f *FS) SystemMCPProfilesDir() string {
	return filepath.Join(f.SystemDir(), "mcp-profiles")
}

func (f *FS) CustomMCPProfilesDir() string {
	return filepath.Join(f.CustomDir(), "mcp-profiles")
}

func (f *FS) StoreDevSkillsDir() string {
	return filepath.Join(f.SkillsDir(), "store", "dev")
}

func (f *FS) StoreProdSkillsDir() string {
	return filepath.Join(f.SkillsDir(), "store", "prod")
}

// GlobalSkillDir returns the directory for a global skill.
func (f *FS) GlobalSkillDir(scope, skillName string) string {
	switch strings.Trim(strings.TrimSpace(scope), "/") {
	case "system":
		return filepath.Join(f.SystemSkillsDir(), skillName)
	case "custom":
		return filepath.Join(f.CustomSkillsDir(), skillName)
	default:
		return filepath.Join(f.SkillsDir(), filepath.FromSlash(scope), skillName)
	}
}

// GlobalSkillSourcePath returns the canonical archived source_path for a skill
// directory relative to one of the visible authored roots.
func (f *FS) GlobalSkillSourcePath(scope, relativeDir string) string {
	cleanScope := strings.Trim(strings.TrimSpace(scope), "/")
	cleanRelativeDir := strings.Trim(strings.TrimSpace(relativeDir), "/")
	switch cleanScope {
	case "system", "custom":
		return path.Join(cleanScope, "skills", cleanRelativeDir)
	default:
		return path.Join(cleanScope, cleanRelativeDir)
	}
}

func normalizeMCPProfileRelativePath(profileName string) (string, error) {
	cleanName := strings.Trim(strings.TrimSpace(profileName), "/")
	if cleanName == "" {
		return "", fmt.Errorf("mcp profile name is required")
	}
	normalized := path.Clean(cleanName)
	if normalized == "." || normalized == "" || normalized == ".." || strings.HasPrefix(normalized, "../") {
		return "", fmt.Errorf("mcp profile name must stay inside the MCP profile library")
	}
	if strings.HasPrefix(normalized, "/") {
		return "", fmt.Errorf("mcp profile name must stay inside the MCP profile library")
	}
	if !strings.HasSuffix(strings.ToLower(normalized), ".json") {
		normalized += ".json"
	}
	return normalized, nil
}

// NormalizeMCPProfileRelativePathForGateway validates one MCP profile filename
// using the same invariant as the Python MCP library path parser: the profile
// path must stay inside the MCP library root and cannot use absolute or parent
// traversal segments.
func NormalizeMCPProfileRelativePathForGateway(profileName string) (string, error) {
	return normalizeMCPProfileRelativePath(profileName)
}

// GlobalMCPProfileFile returns the canonical JSON file path for one reusable
// MCP library item. MCP profiles stay aligned to the Claude Code-style
// `mcpServers` JSON shape, but Deer Flow stores them as one profile per file so
// agents can bind them independently.
func (f *FS) GlobalMCPProfileFile(scope, profileName string) (string, error) {
	cleanName, err := normalizeMCPProfileRelativePath(profileName)
	if err != nil {
		return "", err
	}
	switch strings.Trim(strings.TrimSpace(scope), "/") {
	case "system":
		return filepath.Join(f.SystemMCPProfilesDir(), filepath.FromSlash(cleanName)), nil
	case "custom":
		return filepath.Join(f.CustomMCPProfilesDir(), filepath.FromSlash(cleanName)), nil
	default:
		return filepath.Join(f.baseDir, filepath.FromSlash(scope), filepath.FromSlash(cleanName)), nil
	}
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
	storePrefix := "store" + string(filepath.Separator)
	if clean == "store" || strings.HasPrefix(clean, storePrefix) {
		return filepath.Join(f.SkillsDir(), clean)
	}
	systemPrefix := "system" + string(filepath.Separator)
	if clean == "system" || strings.HasPrefix(clean, systemPrefix) {
		return filepath.Join(f.baseDir, clean)
	}
	customPrefix := "custom" + string(filepath.Separator)
	if clean == "custom" || strings.HasPrefix(clean, customPrefix) {
		return filepath.Join(f.baseDir, clean)
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
