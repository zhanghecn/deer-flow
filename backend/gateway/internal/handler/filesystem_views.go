package handler

import (
	"archive/zip"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"github.com/google/uuid"
	"github.com/openagents/gateway/internal/model"
	"github.com/openagents/gateway/pkg/storage"
	"gopkg.in/yaml.v3"
)

const threadVirtualPathPrefix = "/mnt/user-data"

type skillListItem struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	License     string `json:"license,omitempty"`
	Category    string `json:"category"`
	Enabled     bool   `json:"enabled"`
}

type skillStateJSON struct {
	Enabled bool `json:"enabled"`
}

type extensionsConfigJSON struct {
	MCPServers map[string]any            `json:"mcpServers"`
	Skills     map[string]skillStateJSON `json:"skills"`
}

type skillFrontmatter struct {
	Name        string `yaml:"name"`
	Description string `yaml:"description"`
	License     string `yaml:"license"`
}

type diskAgentConfig struct {
	Name        string                   `yaml:"name"`
	Description string                   `yaml:"description"`
	Model       *string                  `yaml:"model"`
	ToolGroups  []string                 `yaml:"tool_groups"`
	McpServers  []string                 `yaml:"mcp_servers"`
	Status      string                   `yaml:"status"`
	AgentsMD    string                   `yaml:"agents_md_path"`
	Memory      *model.AgentMemoryConfig `yaml:"memory"`
	SkillRefs   []model.SkillRef         `yaml:"skill_refs"`
}

func readExtensionsConfig(configDir string) (extensionsConfigJSON, error) {
	configPath := filepath.Join(configDir, "extensions_config.json")
	data, err := os.ReadFile(configPath)
	if err != nil {
		if os.IsNotExist(err) {
			return extensionsConfigJSON{
				MCPServers: map[string]any{},
				Skills:     map[string]skillStateJSON{},
			}, nil
		}
		return extensionsConfigJSON{}, err
	}

	var cfg extensionsConfigJSON
	if err := json.Unmarshal(data, &cfg); err != nil {
		return extensionsConfigJSON{}, err
	}
	if cfg.MCPServers == nil {
		cfg.MCPServers = map[string]any{}
	}
	if cfg.Skills == nil {
		cfg.Skills = map[string]skillStateJSON{}
	}
	return cfg, nil
}

func writeExtensionsConfig(configDir string, cfg extensionsConfigJSON) error {
	if cfg.MCPServers == nil {
		cfg.MCPServers = map[string]any{}
	}
	if cfg.Skills == nil {
		cfg.Skills = map[string]skillStateJSON{}
	}

	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(configDir, "extensions_config.json"), data, 0644)
}

func parseSkillFrontmatter(skillFile string) (skillFrontmatter, error) {
	data, err := os.ReadFile(skillFile)
	if err != nil {
		return skillFrontmatter{}, err
	}

	text := string(data)
	if !strings.HasPrefix(text, "---\n") {
		return skillFrontmatter{}, fmt.Errorf("missing YAML frontmatter: %s", skillFile)
	}
	rest := strings.TrimPrefix(text, "---\n")
	end := strings.Index(rest, "\n---")
	if end < 0 {
		return skillFrontmatter{}, fmt.Errorf("invalid YAML frontmatter: %s", skillFile)
	}

	var meta skillFrontmatter
	if err := yaml.Unmarshal([]byte(rest[:end]), &meta); err != nil {
		return skillFrontmatter{}, err
	}
	meta.Name = strings.TrimSpace(meta.Name)
	meta.Description = strings.TrimSpace(meta.Description)
	meta.License = strings.TrimSpace(meta.License)
	if meta.Name == "" {
		return skillFrontmatter{}, fmt.Errorf("skill name missing in %s", skillFile)
	}
	return meta, nil
}

func skillScopeRoots(fsStore *storage.FS, status string) map[string]string {
	switch strings.TrimSpace(status) {
	case "dev":
		return map[string]string{"store/dev": fsStore.StoreDevSkillsDir()}
	case "prod":
		return map[string]string{"store/prod": fsStore.StoreProdSkillsDir()}
	case "shared":
		return map[string]string{"shared": fsStore.SharedSkillsDir()}
	default:
		return map[string]string{
			"shared":     fsStore.SharedSkillsDir(),
			"store/dev":  fsStore.StoreDevSkillsDir(),
			"store/prod": fsStore.StoreProdSkillsDir(),
		}
	}
}

func listFilesystemSkills(fsStore *storage.FS, configDir string, status string) ([]skillListItem, error) {
	extensionsCfg, err := readExtensionsConfig(configDir)
	if err != nil {
		return nil, err
	}

	var skills []skillListItem
	for category, root := range skillScopeRoots(fsStore, status) {
		if info, err := os.Stat(root); err != nil || !info.IsDir() {
			continue
		}

		err = filepath.WalkDir(root, func(path string, d fs.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			name := d.Name()
			if d.IsDir() && strings.HasPrefix(name, ".") {
				if path == root {
					return nil
				}
				return filepath.SkipDir
			}
			if d.IsDir() || name != "SKILL.md" {
				return nil
			}

			meta, err := parseSkillFrontmatter(path)
			if err != nil {
				return nil
			}
			state, ok := extensionsCfg.Skills[meta.Name]
			skills = append(skills, skillListItem{
				Name:        meta.Name,
				Description: meta.Description,
				License:     meta.License,
				Category:    category,
				Enabled:     !ok || state.Enabled,
			})
			return nil
		})
		if err != nil {
			return nil, err
		}
	}

	slices.SortFunc(skills, func(a, b skillListItem) int {
		return strings.Compare(a.Name, b.Name)
	})
	return skills, nil
}

func loadFilesystemSkillByName(fsStore *storage.FS, configDir string, name string) (*skillListItem, error) {
	skills, err := listFilesystemSkills(fsStore, configDir, "")
	if err != nil {
		return nil, err
	}
	for i := range skills {
		if skills[i].Name == name {
			return &skills[i], nil
		}
	}
	return nil, nil
}

func agentStatusRoots(fsStore *storage.FS, status string) []string {
	switch strings.TrimSpace(status) {
	case "dev":
		return []string{filepath.Join(fsStore.BaseDir(), "agents", "dev")}
	case "prod":
		return []string{filepath.Join(fsStore.BaseDir(), "agents", "prod")}
	default:
		return []string{
			filepath.Join(fsStore.BaseDir(), "agents", "dev"),
			filepath.Join(fsStore.BaseDir(), "agents", "prod"),
		}
	}
}

func parseAgentConfigFile(configFile string) (diskAgentConfig, error) {
	data, err := os.ReadFile(configFile)
	if err != nil {
		return diskAgentConfig{}, err
	}
	var cfg diskAgentConfig
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return diskAgentConfig{}, err
	}
	return cfg, nil
}

func loadFilesystemAgent(fsStore *storage.FS, name string, status string, includeMarkdown bool) (*model.Agent, error) {
	agentDir := fsStore.AgentDir(name, status)
	configFile := filepath.Join(agentDir, "config.yaml")
	if info, err := os.Stat(configFile); err != nil || info.IsDir() {
		return nil, nil
	}

	cfg, err := parseAgentConfigFile(configFile)
	if err != nil {
		return nil, err
	}

	agent := &model.Agent{
		ID:          uuid.Nil,
		Name:        strings.TrimSpace(cfg.Name),
		Description: cfg.Description,
		Model:       cfg.Model,
		ToolGroups:  cfg.ToolGroups,
		McpServers:  cfg.McpServers,
		Status:      status,
		Memory:      cfg.Memory,
		Skills:      cfg.SkillRefs,
	}
	if agent.Name == "" {
		agent.Name = filepath.Base(agentDir)
	}

	if includeMarkdown {
		agentsMDPath := strings.TrimSpace(cfg.AgentsMD)
		if agentsMDPath == "" {
			agentsMDPath = "AGENTS.md"
		}
		data, err := os.ReadFile(filepath.Join(agentDir, filepath.Clean(agentsMDPath)))
		if err == nil {
			agent.AgentsMD = string(data)
		}
	}
	return agent, nil
}

func listFilesystemAgents(fsStore *storage.FS, status string) ([]model.Agent, error) {
	var agents []model.Agent
	for _, root := range agentStatusRoots(fsStore, status) {
		entries, err := os.ReadDir(root)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return nil, err
		}

		currentStatus := filepath.Base(root)
		for _, entry := range entries {
			if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
				continue
			}
			agent, err := loadFilesystemAgent(fsStore, entry.Name(), currentStatus, false)
			if err != nil {
				return nil, err
			}
			if agent != nil {
				agents = append(agents, *agent)
			}
		}
	}

	slices.SortFunc(agents, func(a, b model.Agent) int {
		return strings.Compare(a.Name, b.Name)
	})
	return agents, nil
}

func filesystemAgentExists(fsStore *storage.FS, name string) bool {
	for _, status := range []string{"dev", "prod"} {
		if info, err := os.Stat(fsStore.AgentDir(name, status)); err == nil && info.IsDir() {
			return true
		}
	}
	return false
}

func rewriteAgentStatus(agentDir string, status string) error {
	configFile := filepath.Join(agentDir, "config.yaml")
	data, err := os.ReadFile(configFile)
	if err != nil {
		return err
	}
	var payload map[string]any
	if err := yaml.Unmarshal(data, &payload); err != nil {
		return err
	}
	payload["status"] = status
	updated, err := yaml.Marshal(payload)
	if err != nil {
		return err
	}
	return os.WriteFile(configFile, updated, 0644)
}

func publishFilesystemAgent(fsStore *storage.FS, name string) (*model.Agent, error) {
	sourceDir := fsStore.AgentDir(name, "dev")
	if info, err := os.Stat(sourceDir); err != nil || !info.IsDir() {
		return nil, fmt.Errorf("agent %q not found", name)
	}

	targetDir := fsStore.AgentDir(name, "prod")
	_ = os.RemoveAll(targetDir)
	if err := fsStore.CopyDir(sourceDir, targetDir); err != nil {
		return nil, err
	}
	if err := rewriteAgentStatus(targetDir, "prod"); err != nil {
		return nil, err
	}
	return loadFilesystemAgent(fsStore, name, "prod", true)
}

func deleteFilesystemAgent(fsStore *storage.FS, name string, status string) error {
	targetStatuses := []string{"dev", "prod"}
	if status != "" {
		targetStatuses = []string{status}
	}

	deleted := false
	for _, item := range targetStatuses {
		targetDir := fsStore.AgentDir(name, item)
		if info, err := os.Stat(targetDir); err == nil && info.IsDir() {
			if err := os.RemoveAll(targetDir); err != nil {
				return err
			}
			deleted = true
		}
	}
	if !deleted {
		return fmt.Errorf("agent %q not found", name)
	}
	return nil
}

func resolveThreadVirtualPath(fsStore *storage.FS, threadID string, virtualPath string) (string, error) {
	cleanVirtual := strings.TrimSpace(virtualPath)
	if cleanVirtual == "" {
		return "", errors.New("path is required")
	}
	if !strings.HasPrefix(cleanVirtual, threadVirtualPathPrefix) {
		return "", fmt.Errorf("path must start with %s", threadVirtualPathPrefix)
	}

	relative := strings.TrimPrefix(cleanVirtual, threadVirtualPathPrefix)
	base := filepath.Clean(fsStore.ThreadUserDataDir(threadID))
	actual := filepath.Clean(filepath.Join(base, relative))
	if actual != base && !strings.HasPrefix(actual, base+string(os.PathSeparator)) {
		return "", errors.New("access denied: path traversal detected")
	}
	return actual, nil
}

func copyFileFromZip(targetPath string, file *zip.File) error {
	if file.FileInfo().IsDir() {
		return os.MkdirAll(targetPath, 0755)
	}
	if file.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("unsafe symlink in archive: %s", file.Name)
	}

	if err := os.MkdirAll(filepath.Dir(targetPath), 0755); err != nil {
		return err
	}
	reader, err := file.Open()
	if err != nil {
		return err
	}
	defer reader.Close()

	writer, err := os.OpenFile(targetPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, file.Mode())
	if err != nil {
		return err
	}
	defer writer.Close()

	_, err = io.Copy(writer, reader)
	return err
}

func installSkillArchive(fsStore *storage.FS, threadID string, virtualPath string) (string, error) {
	archivePath, err := resolveThreadVirtualPath(fsStore, threadID, virtualPath)
	if err != nil {
		return "", err
	}

	info, err := os.Stat(archivePath)
	if err != nil {
		return "", err
	}
	if info.IsDir() {
		return "", errors.New("path is not a file")
	}
	if filepath.Ext(archivePath) != ".skill" {
		return "", errors.New("file must have .skill extension")
	}

	reader, err := zip.OpenReader(archivePath)
	if err != nil {
		return "", fmt.Errorf("invalid skill archive: %w", err)
	}
	defer reader.Close()

	tempDir, err := os.MkdirTemp("", "openagents-skill-install-*")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(tempDir)

	var totalSize uint64
	for _, file := range reader.File {
		totalSize += file.UncompressedSize64
		if totalSize > 100*1024*1024 {
			return "", errors.New("skill archive too large when extracted (>100MB)")
		}
		cleanName := filepath.Clean(file.Name)
		if filepath.IsAbs(cleanName) || strings.HasPrefix(cleanName, "..") || strings.Contains(cleanName, "../") {
			return "", fmt.Errorf("unsafe path in archive: %s", file.Name)
		}
		if err := copyFileFromZip(filepath.Join(tempDir, cleanName), file); err != nil {
			return "", err
		}
	}

	items, err := os.ReadDir(tempDir)
	if err != nil {
		return "", err
	}
	if len(items) == 0 {
		return "", errors.New("skill archive is empty")
	}

	skillDir := tempDir
	if len(items) == 1 && items[0].IsDir() {
		skillDir = filepath.Join(tempDir, items[0].Name())
	}

	meta, err := parseSkillFrontmatter(filepath.Join(skillDir, "SKILL.md"))
	if err != nil {
		return "", err
	}

	targetDir := fsStore.GlobalSkillDir("store/dev", meta.Name)
	if info, err := os.Stat(targetDir); err == nil && info.IsDir() {
		return "", fmt.Errorf("skill %q already exists", meta.Name)
	}
	if err := fsStore.CopyDir(skillDir, targetDir); err != nil {
		return "", err
	}
	return meta.Name, nil
}
