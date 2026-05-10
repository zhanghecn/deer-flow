package service

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/openagents/gateway/internal/agentfs"
	"github.com/openagents/gateway/internal/model"
	"gopkg.in/yaml.v3"
)

const (
	agentPackageKind          = "openagents.agent.package"
	agentPackageSchemaVersion = 1
)

type ImportAgentPackageOptions struct {
	TargetName string
	Status     string
	Overwrite  bool
	UserID     uuid.UUID
}

func (s *AgentService) ExportPackage(_ context.Context, name string, status string) (*model.AgentPackage, error) {
	normalizedStatus, err := normalizeAgentPackageStatus(status, "dev")
	if err != nil {
		return nil, err
	}
	agent, err := agentfs.LoadAgent(s.fs, name, normalizedStatus, true)
	if err != nil {
		return nil, err
	}
	if agent == nil {
		return nil, fmt.Errorf("agent %q (%s) not found", name, normalizedStatus)
	}

	files, err := collectAgentPackageFiles(s.fs.AgentDir(name, normalizedStatus))
	if err != nil {
		return nil, err
	}

	return &model.AgentPackage{
		SchemaVersion: agentPackageSchemaVersion,
		Kind:          agentPackageKind,
		ExportedAt:    time.Now().UTC(),
		Agent:         *agent,
		Files:         files,
	}, nil
}

func (s *AgentService) ImportPackage(_ context.Context, pkg model.AgentPackage, opts ImportAgentPackageOptions) (*model.Agent, error) {
	if err := validateAgentPackage(pkg); err != nil {
		return nil, err
	}
	if opts.UserID == uuid.Nil {
		return nil, fmt.Errorf("importing an agent package requires an authenticated user")
	}

	targetName := strings.TrimSpace(opts.TargetName)
	if targetName == "" {
		targetName = pkg.Agent.Name
	}
	normalizedName, err := normalizeImportedAgentName(targetName)
	if err != nil {
		return nil, err
	}

	statusFallback := pkg.Agent.Status
	if statusFallback == "" {
		statusFallback = "dev"
	}
	normalizedStatus, err := normalizeAgentPackageStatus(opts.Status, statusFallback)
	if err != nil {
		return nil, err
	}

	decodedFiles, fileIndex, err := decodeAgentPackageFiles(pkg.Files)
	if err != nil {
		return nil, err
	}
	configBytes, ok := decodedFiles["config.yaml"]
	if !ok {
		return nil, fmt.Errorf("agent package is missing config.yaml")
	}
	if _, ok := decodedFiles["AGENTS.md"]; !ok {
		return nil, fmt.Errorf("agent package is missing AGENTS.md")
	}
	rewrittenConfig, err := s.rewriteImportedAgentConfig(configBytes, normalizedName, normalizedStatus, opts.UserID, fileIndex)
	if err != nil {
		return nil, err
	}
	decodedFiles["config.yaml"] = rewrittenConfig

	targetDir := s.fs.AgentDir(normalizedName, normalizedStatus)
	if !opts.Overwrite {
		if info, err := os.Stat(targetDir); err == nil && info.IsDir() {
			return nil, fmt.Errorf("agent %q (%s) already exists", normalizedName, normalizedStatus)
		} else if err != nil && !os.IsNotExist(err) {
			return nil, err
		}
	}

	parentDir := filepath.Dir(targetDir)
	if err := os.MkdirAll(parentDir, 0o755); err != nil {
		return nil, err
	}
	stageDir, err := os.MkdirTemp(parentDir, "."+normalizedName+"-import-*")
	if err != nil {
		return nil, err
	}
	committed := false
	defer func() {
		if !committed {
			_ = os.RemoveAll(stageDir)
		}
	}()

	// Write into a sibling temp directory first so a malformed package never
	// leaves a half-imported archive at the canonical agent path.
	if err := writeDecodedAgentPackageFiles(stageDir, decodedFiles); err != nil {
		return nil, err
	}
	if opts.Overwrite {
		if err := os.RemoveAll(targetDir); err != nil {
			return nil, err
		}
	}
	if err := os.Rename(stageDir, targetDir); err != nil {
		return nil, err
	}
	committed = true

	agent, err := agentfs.LoadAgent(s.fs, normalizedName, normalizedStatus, true)
	if err != nil {
		return nil, err
	}
	if agent == nil {
		return nil, fmt.Errorf("imported agent %q (%s) could not be loaded", normalizedName, normalizedStatus)
	}
	return agent, nil
}

func validateAgentPackage(pkg model.AgentPackage) error {
	if pkg.SchemaVersion != agentPackageSchemaVersion {
		return fmt.Errorf("unsupported agent package schema_version %d", pkg.SchemaVersion)
	}
	if strings.TrimSpace(pkg.Kind) != agentPackageKind {
		return fmt.Errorf("unsupported agent package kind %q", pkg.Kind)
	}
	if len(pkg.Files) == 0 {
		return fmt.Errorf("agent package contains no files")
	}
	return nil
}

func normalizeAgentPackageStatus(raw string, fallback string) (string, error) {
	status := strings.TrimSpace(raw)
	if status == "" {
		status = strings.TrimSpace(fallback)
	}
	switch status {
	case "dev", "prod":
		return status, nil
	default:
		return "", fmt.Errorf("agent status must be dev or prod")
	}
}

func normalizeImportedAgentName(raw string) (string, error) {
	name := strings.TrimSpace(raw)
	if name == "" {
		return "", fmt.Errorf("agent package name is required")
	}
	if len(name) > 128 {
		return "", fmt.Errorf("agent package name must be at most 128 characters")
	}
	if isReservedAgentName(name) {
		return "", fmt.Errorf("agent %q is reserved and cannot be imported", builtinLeadAgentName)
	}
	if strings.ContainsAny(name, `/\`) || path.Clean(name) != name || strings.HasPrefix(name, ".") {
		return "", fmt.Errorf("agent package name must be a single safe path segment")
	}
	return name, nil
}

func collectAgentPackageFiles(root string) ([]model.AgentPackageFile, error) {
	files := make([]model.AgentPackageFile, 0)
	err := filepath.WalkDir(root, func(currentPath string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("agent package export refuses symlinked archive file %s", currentPath)
		}
		if !info.Mode().IsRegular() {
			return nil
		}
		relativePath, err := filepath.Rel(root, currentPath)
		if err != nil {
			return err
		}
		packagePath, err := normalizeAgentPackageFilePath(filepath.ToSlash(relativePath))
		if err != nil {
			return err
		}
		data, err := os.ReadFile(currentPath)
		if err != nil {
			return err
		}
		sum := sha256.Sum256(data)
		files = append(files, model.AgentPackageFile{
			Path:          packagePath,
			ContentBase64: base64.StdEncoding.EncodeToString(data),
			SizeBytes:     int64(len(data)),
			SHA256:        hex.EncodeToString(sum[:]),
		})
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Slice(files, func(i, j int) bool {
		return files[i].Path < files[j].Path
	})
	return files, nil
}

func decodeAgentPackageFiles(files []model.AgentPackageFile) (map[string][]byte, map[string]model.AgentPackageFile, error) {
	decoded := make(map[string][]byte, len(files))
	index := make(map[string]model.AgentPackageFile, len(files))
	for _, file := range files {
		packagePath, err := normalizeAgentPackageFilePath(file.Path)
		if err != nil {
			return nil, nil, err
		}
		if _, exists := decoded[packagePath]; exists {
			return nil, nil, fmt.Errorf("agent package duplicates file %s", packagePath)
		}
		data, err := base64.StdEncoding.DecodeString(file.ContentBase64)
		if err != nil {
			return nil, nil, fmt.Errorf("decode %s: %w", packagePath, err)
		}
		if file.SizeBytes > 0 && int64(len(data)) != file.SizeBytes {
			return nil, nil, fmt.Errorf("agent package file %s size mismatch", packagePath)
		}
		if strings.TrimSpace(file.SHA256) != "" {
			sum := sha256.Sum256(data)
			if !strings.EqualFold(file.SHA256, hex.EncodeToString(sum[:])) {
				return nil, nil, fmt.Errorf("agent package file %s checksum mismatch", packagePath)
			}
		}
		file.Path = packagePath
		decoded[packagePath] = data
		index[packagePath] = file
	}
	return decoded, index, nil
}

func normalizeAgentPackageFilePath(raw string) (string, error) {
	if strings.Contains(raw, "\\") {
		return "", fmt.Errorf("agent package file paths must use forward slashes")
	}
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" || strings.HasPrefix(trimmed, "/") {
		return "", fmt.Errorf("agent package file path must be relative")
	}
	normalized := path.Clean(trimmed)
	if normalized == "." || normalized == ".." || strings.HasPrefix(normalized, "../") {
		return "", fmt.Errorf("agent package file path must stay inside the agent archive")
	}
	return normalized, nil
}

func (s *AgentService) rewriteImportedAgentConfig(
	configBytes []byte,
	name string,
	status string,
	userID uuid.UUID,
	files map[string]model.AgentPackageFile,
) ([]byte, error) {
	var config map[string]interface{}
	if err := yaml.Unmarshal(configBytes, &config); err != nil {
		return nil, fmt.Errorf("parse config.yaml: %w", err)
	}
	if config == nil {
		config = map[string]interface{}{}
	}

	var skillPayload struct {
		SkillRefs []model.SkillRef `yaml:"skill_refs"`
	}
	if err := yaml.Unmarshal(configBytes, &skillPayload); err != nil {
		return nil, fmt.Errorf("parse config.yaml skill_refs: %w", err)
	}
	if len(skillPayload.SkillRefs) > 0 {
		normalizedRefs, err := normalizeImportedPackageSkillRefs(skillPayload.SkillRefs, files)
		if err != nil {
			return nil, err
		}
		config["skill_refs"] = normalizedRefs
	}

	config["name"] = name
	config["status"] = status
	config["owner_user_id"] = userID.String()
	config["agents_md_path"] = "AGENTS.md"

	data, err := yaml.Marshal(config)
	if err != nil {
		return nil, fmt.Errorf("marshal imported config.yaml: %w", err)
	}
	return data, nil
}

func normalizeImportedPackageSkillRefs(refs []model.SkillRef, files map[string]model.AgentPackageFile) ([]model.SkillRef, error) {
	normalized := make([]model.SkillRef, 0, len(refs))
	seen := make(map[string]struct{}, len(refs))
	for _, ref := range refs {
		name := strings.TrimSpace(ref.Name)
		if name == "" {
			return nil, fmt.Errorf("imported skill ref name is required")
		}
		materializedPath := strings.Trim(strings.TrimSpace(ref.MaterializedPath), "/")
		if materializedPath == "" {
			if strings.TrimSpace(ref.SourcePath) != "" {
				derivedPath, err := deriveMaterializedPathFromSourcePath(ref.SourcePath)
				if err != nil {
					return nil, fmt.Errorf("skill %q: %w", name, err)
				}
				materializedPath = derivedPath
			} else {
				materializedPath = path.Join("skills", name)
			}
		}
		materializedPath, err := normalizeMaterializedPath(materializedPath)
		if err != nil {
			return nil, fmt.Errorf("skill %q: %w", name, err)
		}
		if !agentPackageContainsFileUnder(files, materializedPath) {
			return nil, fmt.Errorf("agent package is missing copied files for skill %q at %s", name, materializedPath)
		}

		key := strings.ToLower(name)
		if _, exists := seen[key]; exists {
			continue
		}
		// Imported packages preserve the copied skill bytes as the source of
		// truth. This keeps migrated agents editable even when the target system
		// does not have the original global skill archive entry.
		normalized = append(normalized, model.SkillRef{
			Name:             name,
			MaterializedPath: materializedPath,
		})
		seen[key] = struct{}{}
	}
	return normalized, nil
}

func agentPackageContainsFileUnder(files map[string]model.AgentPackageFile, dir string) bool {
	prefix := strings.Trim(path.Clean(dir), "/") + "/"
	for packagePath := range files {
		if strings.HasPrefix(packagePath, prefix) {
			return true
		}
	}
	return false
}

func writeDecodedAgentPackageFiles(root string, files map[string][]byte) error {
	paths := make([]string, 0, len(files))
	for packagePath := range files {
		paths = append(paths, packagePath)
	}
	sort.Strings(paths)
	for _, packagePath := range paths {
		targetPath := filepath.Join(root, filepath.FromSlash(packagePath))
		if err := os.MkdirAll(filepath.Dir(targetPath), 0o755); err != nil {
			return err
		}
		if err := os.WriteFile(targetPath, files[packagePath], 0o644); err != nil {
			return err
		}
	}
	return nil
}
