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

	"github.com/openagents/gateway/internal/skillfs"
	"github.com/openagents/gateway/pkg/storage"
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

func readExtensionsConfig(configPath string) (extensionsConfigJSON, error) {
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

func writeExtensionsConfig(configPath string, cfg extensionsConfigJSON) error {
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
	return os.WriteFile(configPath, data, 0644)
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

func listFilesystemSkills(fsStore *storage.FS, extensionsConfigPath string, status string) ([]skillListItem, error) {
	extensionsCfg, err := readExtensionsConfig(extensionsConfigPath)
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

			meta, err := skillfs.ParseFrontmatterFile(path)
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

func loadFilesystemSkillByName(fsStore *storage.FS, extensionsConfigPath string, name string) (*skillListItem, error) {
	skills, err := listFilesystemSkills(fsStore, extensionsConfigPath, "")
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

	meta, err := skillfs.ParseFrontmatterFile(filepath.Join(skillDir, "SKILL.md"))
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
