package service

import (
	"archive/zip"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"slices"
	"strings"

	"github.com/google/uuid"
	"github.com/openagents/gateway/internal/model"
	"github.com/openagents/gateway/internal/skillfs"
	"github.com/openagents/gateway/pkg/storage"
	"gopkg.in/yaml.v3"
)

type SkillService struct {
	fs *storage.FS
}

var ErrSkillReadOnly = errors.New("skill is read-only")
var ErrSkillAmbiguous = errors.New("skill is ambiguous")
var ErrSkillInvalidSourcePath = errors.New("invalid skill source path")

type skillLocation struct {
	scope       string
	relativeDir string
}

func NewSkillService(fs *storage.FS) *SkillService {
	return &SkillService{fs: fs}
}

func (s *SkillService) Create(_ context.Context, req model.CreateSkillRequest, _ uuid.UUID) (*model.Skill, error) {
	name := strings.TrimSpace(req.Name)
	if scopes := s.findSkillScopes(name); len(scopes) > 0 {
		return nil, fmt.Errorf("skill %q already exists in %s", name, strings.Join(scopes, ", "))
	}

	skillMD, err := ensureSkillFrontmatter(name, req.Description, req.SkillMD)
	if err != nil {
		return nil, err
	}
	if err := s.fs.WriteGlobalSkillFile("custom", name, skillMD); err != nil {
		return nil, fmt.Errorf("write skill file: %w", err)
	}
	if err := skillfs.WriteDescriptionI18nFile(
		s.fs.GlobalSkillDir("custom", name),
		req.DescriptionI18n,
	); err != nil {
		return nil, fmt.Errorf("write skill i18n file: %w", err)
	}

	return s.loadSkillFromLocation(skillLocation{scope: "custom", relativeDir: name})
}

func (s *SkillService) Update(_ context.Context, name string, req model.UpdateSkillRequest) (*model.Skill, error) {
	location, err := s.locateEditableSkillLocation(name)
	if err != nil {
		return nil, err
	}

	existing, err := s.loadSkillFromLocation(location)
	if err != nil {
		return nil, err
	}

	description := existing.Description
	if req.Description != nil {
		description = *req.Description
	}
	descriptionI18n := existing.DescriptionI18n
	if req.DescriptionI18n != nil {
		descriptionI18n = *req.DescriptionI18n
	}

	skillMD := existing.SkillMD
	if req.SkillMD != nil {
		skillMD = *req.SkillMD
	}
	skillMD, err = ensureSkillFrontmatter(name, description, skillMD)
	if err != nil {
		return nil, err
	}
	if err := s.fs.WriteGlobalSkillFile(location.scope, location.relativeDir, skillMD); err != nil {
		return nil, fmt.Errorf("write skill file: %w", err)
	}
	if err := skillfs.WriteDescriptionI18nFile(
		s.fs.GlobalSkillDir(location.scope, location.relativeDir),
		descriptionI18n,
	); err != nil {
		return nil, fmt.Errorf("write skill i18n file: %w", err)
	}

	return s.loadSkillFromLocation(location)
}

func (s *SkillService) Delete(_ context.Context, name string) error {
	location, err := s.locateEditableSkillLocation(name)
	if err != nil {
		return err
	}
	if err := os.RemoveAll(s.fs.GlobalSkillDir(location.scope, location.relativeDir)); err != nil {
		return err
	}
	return nil
}

func (s *SkillService) Publish(_ context.Context, name string) (*model.Skill, error) {
	devLocation, ok := s.findSingleScopeLocationByName(name, "store/dev")
	if !ok {
		if scopes := s.findSkillScopes(name); len(scopes) > 0 {
			return nil, fmt.Errorf("skill %q no longer publishes from %s; only legacy store/dev skills can publish", name, strings.Join(scopes, ", "))
		}
		return nil, fmt.Errorf("skill %q not found in store/dev", name)
	}

	sourceDir := s.fs.GlobalSkillDir(devLocation.scope, devLocation.relativeDir)
	targetDir := s.fs.GlobalSkillDir("store/prod", devLocation.relativeDir)
	_ = os.RemoveAll(targetDir)
	if err := s.fs.CopyDir(sourceDir, targetDir); err != nil {
		return nil, fmt.Errorf("copy skill to prod: %w", err)
	}

	return s.loadSkillFromLocation(skillLocation{
		scope:       "store/prod",
		relativeDir: devLocation.relativeDir,
	})
}

func (s *SkillService) Get(_ context.Context, name string, sourcePath string) (*model.Skill, error) {
	if trimmedSourcePath := strings.TrimSpace(sourcePath); trimmedSourcePath != "" {
		location, err := parseSkillDocumentSourcePath(trimmedSourcePath)
		if err != nil {
			return nil, fmt.Errorf("%w: %v", ErrSkillInvalidSourcePath, err)
		}
		skill, err := s.loadSkillFromLocation(location)
		if err != nil {
			return nil, err
		}
		if strings.TrimSpace(skill.Name) != strings.TrimSpace(name) {
			return nil, fmt.Errorf("skill %q not found at %s", name, trimmedSourcePath)
		}
		return skill, nil
	}

	location, err := s.locateUniqueSkillLocation(name)
	if err != nil {
		return nil, err
	}
	return s.loadSkillFromLocation(location)
}

func (s *SkillService) Export(_ context.Context, name string, sourcePath string) (string, []byte, error) {
	location, err := s.resolveSkillLocation(name, sourcePath)
	if err != nil {
		return "", nil, err
	}

	skill, err := s.loadSkillFromLocation(location)
	if err != nil {
		return "", nil, err
	}

	skillDir := s.fs.GlobalSkillDir(location.scope, location.relativeDir)
	archiveRoot := exportArchiveBaseName(strings.TrimSpace(skill.Name))
	if archiveRoot == "" {
		archiveRoot = exportArchiveBaseName(filepath.Base(location.relativeDir))
	}
	if archiveRoot == "" {
		archiveRoot = "skill"
	}

	data, err := packageSkillArchive(skillDir, archiveRoot)
	if err != nil {
		return "", nil, err
	}
	return archiveRoot + ".skill", data, nil
}

func (s *SkillService) findSkillScopes(name string) []string {
	locations, err := s.findSkillLocationsByName(name)
	if err != nil {
		return nil
	}
	scopes := make([]string, 0, len(locations))
	for _, location := range locations {
		scopes = append(scopes, location.scope)
	}
	slices.Sort(scopes)
	scopes = slices.Compact(scopes)
	return scopes
}

func (s *SkillService) locateUniqueSkillLocation(name string) (skillLocation, error) {
	locations, err := s.findSkillLocationsByName(name)
	if err != nil {
		return skillLocation{}, err
	}
	switch len(locations) {
	case 0:
		return skillLocation{}, fmt.Errorf("skill %q not found", name)
	case 1:
		return locations[0], nil
	default:
		return skillLocation{}, fmt.Errorf("%w: skill %q is ambiguous across %s", ErrSkillAmbiguous, name, strings.Join(s.findSkillScopes(name), ", "))
	}
}

func (s *SkillService) locateEditableSkillLocation(name string) (skillLocation, error) {
	location, ok := s.findSingleScopeLocationByName(name, "custom")
	if ok {
		return location, nil
	}

	scopes := s.findSkillScopes(name)
	if len(scopes) == 0 {
		return skillLocation{}, fmt.Errorf("skill %q not found", name)
	}
	return skillLocation{}, fmt.Errorf("%w: skill %q is read-only in %s", ErrSkillReadOnly, name, strings.Join(scopes, ", "))
}

func (s *SkillService) resolveSkillLocation(name string, sourcePath string) (skillLocation, error) {
	if trimmedSourcePath := strings.TrimSpace(sourcePath); trimmedSourcePath != "" {
		location, err := parseSkillDocumentSourcePath(trimmedSourcePath)
		if err != nil {
			return skillLocation{}, fmt.Errorf("%w: %v", ErrSkillInvalidSourcePath, err)
		}
		skill, err := s.loadSkillFromLocation(location)
		if err != nil {
			return skillLocation{}, err
		}
		if strings.TrimSpace(skill.Name) != strings.TrimSpace(name) {
			return skillLocation{}, fmt.Errorf("skill %q not found at %s", name, trimmedSourcePath)
		}
		return location, nil
	}
	return s.locateUniqueSkillLocation(name)
}

func (s *SkillService) loadSkillFromLocation(location skillLocation) (*model.Skill, error) {
	skillDir := s.fs.GlobalSkillDir(location.scope, location.relativeDir)
	skillPath := filepath.Join(skillDir, "SKILL.md")
	data, err := os.ReadFile(skillPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("skill %q not found", location.relativeDir)
		}
		return nil, err
	}

	meta, err := skillfs.ParseFrontmatter(string(data))
	if err != nil {
		return nil, err
	}
	descriptionI18n, err := skillfs.LoadDescriptionI18nFile(filepath.Dir(skillPath))
	if err != nil {
		descriptionI18n = nil
	}

	status := "dev"
	switch location.scope {
	case "system":
		status = "prod"
	case "custom":
		status = "dev"
	case "store/dev":
		status = "dev"
	case "store/prod":
		status = "prod"
	}

	return &model.Skill{
		Name:            meta.Name,
		Description:     meta.Description,
		DescriptionI18n: descriptionI18n,
		Status:          status,
		Category:        location.scope,
		SourcePath:      s.fs.GlobalSkillSourcePath(location.scope, filepath.ToSlash(location.relativeDir)),
		CanEdit:         location.scope == "custom",
		SkillMD:         string(data),
	}, nil
}

func (s *SkillService) findSingleScopeLocationByName(name string, scope string) (skillLocation, bool) {
	locations, err := s.findSkillLocationsByName(name)
	if err != nil {
		return skillLocation{}, false
	}
	var matches []skillLocation
	for _, location := range locations {
		if location.scope == scope {
			matches = append(matches, location)
		}
	}
	if len(matches) != 1 {
		return skillLocation{}, false
	}
	return matches[0], true
}

func (s *SkillService) findSkillLocationsByName(name string) ([]skillLocation, error) {
	trimmedName := strings.TrimSpace(name)
	if trimmedName == "" {
		return nil, nil
	}

	locations := make([]skillLocation, 0)
	for _, root := range s.skillScopeRoots() {
		if info, err := os.Stat(root.dir); err != nil || !info.IsDir() {
			continue
		}
		err := filepath.WalkDir(root.dir, func(currentPath string, d fs.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if d.IsDir() {
				if currentPath == root.dir {
					return nil
				}
				if strings.HasPrefix(d.Name(), ".") {
					return filepath.SkipDir
				}
				return nil
			}
			if d.Name() != "SKILL.md" {
				return nil
			}

			meta, err := skillfs.ParseFrontmatterFile(currentPath)
			if err != nil || strings.TrimSpace(meta.Name) != trimmedName {
				return nil
			}
			relativeDir, err := filepath.Rel(root.dir, filepath.Dir(currentPath))
			if err != nil {
				return nil
			}
			locations = append(locations, skillLocation{
				scope:       root.scope,
				relativeDir: filepath.ToSlash(relativeDir),
			})
			return nil
		})
		if err != nil {
			return nil, err
		}
	}

	slices.SortFunc(locations, func(a, b skillLocation) int {
		if byScope := strings.Compare(a.scope, b.scope); byScope != 0 {
			return byScope
		}
		return strings.Compare(a.relativeDir, b.relativeDir)
	})
	return locations, nil
}

func (s *SkillService) skillScopeRoots() []struct {
	scope string
	dir   string
} {
	return []struct {
		scope string
		dir   string
	}{
		{scope: "custom", dir: s.fs.CustomSkillsDir()},
		{scope: "system", dir: s.fs.SystemSkillsDir()},
		{scope: "store/dev", dir: s.fs.StoreDevSkillsDir()},
		{scope: "store/prod", dir: s.fs.StoreProdSkillsDir()},
	}
}

func parseSkillDocumentSourcePath(sourcePath string) (skillLocation, error) {
	normalized := strings.Trim(strings.TrimSpace(sourcePath), "/")
	switch {
	case strings.HasPrefix(normalized, "system/skills/"):
		return skillLocation{
			scope:       "system",
			relativeDir: strings.TrimPrefix(normalized, "system/skills/"),
		}, nil
	case strings.HasPrefix(normalized, "custom/skills/"):
		return skillLocation{
			scope:       "custom",
			relativeDir: strings.TrimPrefix(normalized, "custom/skills/"),
		}, nil
	case strings.HasPrefix(normalized, "store/dev/"):
		return skillLocation{
			scope:       "store/dev",
			relativeDir: strings.TrimPrefix(normalized, "store/dev/"),
		}, nil
	case strings.HasPrefix(normalized, "store/prod/"):
		return skillLocation{
			scope:       "store/prod",
			relativeDir: strings.TrimPrefix(normalized, "store/prod/"),
		}, nil
	default:
		return skillLocation{}, fmt.Errorf("skill source_path must start with system/skills/, custom/skills/, store/dev/, or store/prod/")
	}
}

func ensureSkillFrontmatter(name string, description string, skillMD string) (string, error) {
	meta, body, hasFrontmatter, err := splitSkillFrontmatter(skillMD)
	if err != nil {
		return "", err
	}
	if meta == nil {
		meta = map[string]interface{}{}
	}
	meta["name"] = strings.TrimSpace(name)
	if strings.TrimSpace(description) != "" {
		meta["description"] = strings.TrimSpace(description)
	}

	data, err := yaml.Marshal(meta)
	if err != nil {
		return "", err
	}

	content := strings.TrimLeft(body, "\n")
	if hasFrontmatter {
		if content == "" {
			return fmt.Sprintf("---\n%s---\n", string(data)), nil
		}
		return fmt.Sprintf("---\n%s---\n\n%s", string(data), content), nil
	}
	if content == "" {
		return fmt.Sprintf("---\n%s---\n", string(data)), nil
	}
	return fmt.Sprintf("---\n%s---\n\n%s", string(data), content), nil
}

func exportArchiveBaseName(name string) string {
	normalized := strings.TrimSpace(name)
	normalized = strings.ReplaceAll(normalized, "/", "-")
	normalized = strings.ReplaceAll(normalized, "\\", "-")
	return strings.Trim(strings.TrimSpace(normalized), "-")
}

func packageSkillArchive(skillDir string, archiveRoot string) ([]byte, error) {
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)

	files := make([]string, 0, 8)
	if err := filepath.WalkDir(skillDir, func(currentPath string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if d.IsDir() {
			return nil
		}
		files = append(files, currentPath)
		return nil
	}); err != nil {
		return nil, err
	}
	sort.Strings(files)

	for _, currentPath := range files {
		relativePath, err := filepath.Rel(skillDir, currentPath)
		if err != nil {
			return nil, err
		}
		archivePath := filepath.ToSlash(filepath.Join(archiveRoot, relativePath))
		fileInfo, err := os.Stat(currentPath)
		if err != nil {
			return nil, err
		}
		header, err := zip.FileInfoHeader(fileInfo)
		if err != nil {
			return nil, err
		}
		// The installer accepts either a wrapped root directory or a flat skill
		// archive. Packaging with one stable root keeps download/install behavior
		// deterministic and avoids collisions when users unpack locally.
		header.Name = archivePath
		header.Method = zip.Deflate
		entryWriter, err := writer.CreateHeader(header)
		if err != nil {
			return nil, err
		}
		content, err := os.ReadFile(currentPath)
		if err != nil {
			return nil, err
		}
		if _, err := entryWriter.Write(content); err != nil {
			return nil, err
		}
	}

	if err := writer.Close(); err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}

func splitSkillFrontmatter(skillMD string) (map[string]interface{}, string, bool, error) {
	if !strings.HasPrefix(skillMD, "---\n") {
		return map[string]interface{}{}, skillMD, false, nil
	}

	rest := strings.TrimPrefix(skillMD, "---\n")
	end := strings.Index(rest, "\n---")
	if end < 0 {
		return nil, "", false, fmt.Errorf("invalid skill frontmatter")
	}

	meta := map[string]interface{}{}
	if err := yaml.Unmarshal([]byte(rest[:end]), &meta); err != nil {
		return nil, "", false, err
	}

	body := strings.TrimPrefix(rest[end:], "\n---")
	body = strings.TrimPrefix(body, "\n")
	return meta, body, true, nil
}
