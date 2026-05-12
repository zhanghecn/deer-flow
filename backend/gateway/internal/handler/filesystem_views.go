package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"slices"
	"strings"

	"github.com/openagents/gateway/internal/service"
	"github.com/openagents/gateway/internal/skillfs"
	"github.com/openagents/gateway/pkg/storage"
)

const threadVirtualPathPrefix = "/mnt/user-data"

type skillListItem struct {
	Name            string            `json:"name"`
	Description     string            `json:"description"`
	DescriptionI18n map[string]string `json:"description_i18n,omitempty"`
	License         string            `json:"license,omitempty"`
	Category        string            `json:"category"`
	SourcePath      string            `json:"source_path"`
	Enabled         bool              `json:"enabled"`
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
		return map[string]string{
			"system":     fsStore.SystemSkillsDir(),
			"custom":     fsStore.CustomSkillsDir(),
			"store/dev":  fsStore.StoreDevSkillsDir(),
			"store/prod": fsStore.StoreProdSkillsDir(),
		}
	case "prod":
		return map[string]string{
			"system":     fsStore.SystemSkillsDir(),
			"custom":     fsStore.CustomSkillsDir(),
			"store/prod": fsStore.StoreProdSkillsDir(),
		}
	default:
		return map[string]string{
			"system":     fsStore.SystemSkillsDir(),
			"custom":     fsStore.CustomSkillsDir(),
			"store/dev":  fsStore.StoreDevSkillsDir(),
			"store/prod": fsStore.StoreProdSkillsDir(),
		}
	}
}

func buildSkillSourcePath(category string, relativeDir string) string {
	cleanCategory := strings.Trim(strings.TrimSpace(category), "/")
	cleanRelative := strings.Trim(strings.TrimSpace(relativeDir), "/")
	switch cleanCategory {
	case "system", "custom":
		return path.Join(cleanCategory, "skills", cleanRelative)
	default:
		return path.Join(cleanCategory, cleanRelative)
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
			descriptionI18n, err := skillfs.LoadDescriptionI18nFile(filepath.Dir(path))
			if err != nil {
				descriptionI18n = nil
			}
			relativeDir, err := filepath.Rel(root, filepath.Dir(path))
			if err != nil {
				return nil
			}
			sourcePath := buildSkillSourcePath(category, filepath.ToSlash(relativeDir))
			state, ok := extensionsCfg.Skills[meta.Name]
			skills = append(skills, skillListItem{
				Name:            meta.Name,
				Description:     meta.Description,
				DescriptionI18n: descriptionI18n,
				License:         meta.License,
				Category:        category,
				SourcePath:      sourcePath,
				Enabled:         !ok || state.Enabled,
			})
			return nil
		})
		if err != nil {
			return nil, err
		}
	}

	slices.SortFunc(skills, func(a, b skillListItem) int {
		if byName := strings.Compare(a.Name, b.Name); byName != 0 {
			return byName
		}
		return strings.Compare(a.SourcePath, b.SourcePath)
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

func resolveThreadVirtualPath(fsStore *storage.FS, userID string, threadID string, virtualPath string) (string, error) {
	cleanVirtual := strings.TrimSpace(virtualPath)
	if cleanVirtual == "" {
		return "", errors.New("path is required")
	}
	if !strings.HasPrefix(cleanVirtual, threadVirtualPathPrefix) {
		return "", fmt.Errorf("path must start with %s", threadVirtualPathPrefix)
	}

	relative := strings.TrimPrefix(cleanVirtual, threadVirtualPathPrefix)
	base := filepath.Clean(fsStore.ThreadUserDataDirForUser(userID, threadID))
	actual := filepath.Clean(filepath.Join(base, relative))
	if actual != base && !strings.HasPrefix(actual, base+string(os.PathSeparator)) {
		return "", errors.New("access denied: path traversal detected")
	}
	return actual, nil
}

func installSkillArchive(ctx context.Context, fsStore *storage.FS, userID string, threadID string, virtualPath string) (string, error) {
	archivePath, err := resolveThreadVirtualPath(fsStore, userID, threadID, virtualPath)
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

	data, err := os.ReadFile(archivePath)
	if err != nil {
		return "", err
	}
	// Thread-file installation and direct upload import share one archive
	// validator so both paths preserve the same custom-skill storage contract.
	skill, err := service.NewSkillService(fsStore).ImportArchive(
		ctx,
		filepath.Base(archivePath),
		data,
	)
	if err != nil {
		return "", err
	}
	return skill.Name, nil
}
