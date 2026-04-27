package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"github.com/openagents/gateway/internal/agentfs"
	"github.com/openagents/gateway/internal/model"
	"github.com/openagents/gateway/pkg/storage"
)

type MCPProfileService struct {
	fs *storage.FS
}

var ErrMCPProfileReadOnly = errors.New("mcp profile is read-only")
var ErrMCPProfileAmbiguous = errors.New("mcp profile is ambiguous")
var ErrMCPProfileInvalidSourcePath = errors.New("invalid mcp profile source path")
var ErrMCPProfileInvalidConfig = errors.New("invalid mcp profile config")
var ErrMCPProfileInUse = errors.New("mcp profile is in use")

type mcpProfileLocation struct {
	scope        string
	relativePath string
}

type mcpProfileDocument struct {
	MCPServers map[string]map[string]any `json:"mcpServers"`
}

func NewMCPProfileService(fs *storage.FS) *MCPProfileService {
	return &MCPProfileService{fs: fs}
}

func normalizeMCPProfileName(name string) (string, error) {
	return storage.NormalizeMCPProfileRelativePathForGateway(name)
}

func (s *MCPProfileService) Create(_ context.Context, req model.CreateMCPProfileRequest) (*model.MCPProfile, error) {
	name, err := normalizeMCPProfileName(req.Name)
	if err != nil {
		return nil, err
	}
	if name == "" {
		return nil, fmt.Errorf("mcp profile name is required")
	}
	if scopes := s.findMCPProfileScopes(name); len(scopes) > 0 {
		return nil, fmt.Errorf("mcp profile %q already exists in %s", name, strings.Join(scopes, ", "))
	}
	if _, err := validateMCPProfileDocument(req.ConfigJSON); err != nil {
		return nil, err
	}

	target, err := s.fs.GlobalMCPProfileFile("custom", name)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return nil, fmt.Errorf("mkdir mcp profile dir: %w", err)
	}
	if err := os.WriteFile(target, req.ConfigJSON, 0o644); err != nil {
		return nil, fmt.Errorf("write mcp profile: %w", err)
	}
	return s.loadMCPProfileFromLocation(mcpProfileLocation{scope: "custom", relativePath: name})
}

func (s *MCPProfileService) Update(_ context.Context, name string, req model.UpdateMCPProfileRequest) (*model.MCPProfile, error) {
	location, err := s.locateEditableMCPProfileLocation(name)
	if err != nil {
		return nil, err
	}
	if _, err := validateMCPProfileDocument(req.ConfigJSON); err != nil {
		return nil, err
	}
	target, err := s.fs.GlobalMCPProfileFile(location.scope, location.relativePath)
	if err != nil {
		return nil, err
	}
	if err := os.WriteFile(target, req.ConfigJSON, 0o644); err != nil {
		return nil, fmt.Errorf("write mcp profile: %w", err)
	}
	return s.loadMCPProfileFromLocation(location)
}

func (s *MCPProfileService) Delete(_ context.Context, name string) error {
	location, err := s.locateEditableMCPProfileLocation(name)
	if err != nil {
		return err
	}
	if err := s.ensureMCPProfileNotInUse(location); err != nil {
		return err
	}
	target, err := s.fs.GlobalMCPProfileFile(location.scope, location.relativePath)
	if err != nil {
		return err
	}
	return os.Remove(target)
}

func (s *MCPProfileService) ensureMCPProfileNotInUse(location mcpProfileLocation) error {
	sourcePath := s.globalMCPProfileSourcePath(location.scope, filepath.ToSlash(location.relativePath))
	agents, err := agentfs.ListAgents(s.fs, "")
	if err != nil {
		return fmt.Errorf("list agents for mcp profile usage: %w", err)
	}
	for _, agent := range agents {
		for _, ref := range agent.McpServers {
			// MCP library refs are stored as source_path strings in agent manifests.
			// Blocking deletion here preserves that archive contract and prevents
			// agents from silently keeping dangling runtime MCP bindings.
			if strings.Trim(strings.TrimSpace(ref), "/") == sourcePath {
				return fmt.Errorf("%w: %s is bound by agent %q (%s)", ErrMCPProfileInUse, sourcePath, agent.Name, agent.Status)
			}
		}
	}
	return nil
}

func (s *MCPProfileService) Get(_ context.Context, name string, sourcePath string) (*model.MCPProfile, error) {
	if trimmedSourcePath := strings.TrimSpace(sourcePath); trimmedSourcePath != "" {
		location, err := parseMCPProfileSourcePath(trimmedSourcePath)
		if err != nil {
			return nil, fmt.Errorf("%w: %v", ErrMCPProfileInvalidSourcePath, err)
		}
		return s.loadMCPProfileFromLocation(location)
	}
	location, err := s.locateUniqueMCPProfileLocation(name)
	if err != nil {
		return nil, err
	}
	return s.loadMCPProfileFromLocation(location)
}

func (s *MCPProfileService) List(_ context.Context) ([]model.MCPProfile, error) {
	locations, err := s.findMCPProfileLocations("")
	if err != nil {
		return nil, err
	}
	profiles := make([]model.MCPProfile, 0, len(locations))
	for _, location := range locations {
		profile, err := s.loadMCPProfileFromLocation(location)
		if err != nil {
			return nil, err
		}
		profiles = append(profiles, *profile)
	}
	return profiles, nil
}

func validateMCPProfileDocument(raw json.RawMessage) (string, error) {
	var document mcpProfileDocument
	if err := json.Unmarshal(raw, &document); err != nil {
		return "", fmt.Errorf("%w: invalid JSON: %v", ErrMCPProfileInvalidConfig, err)
	}
	if len(document.MCPServers) != 1 {
		return "", fmt.Errorf("%w: mcp profile must define exactly one mcpServers entry", ErrMCPProfileInvalidConfig)
	}
	for serverName, serverConfig := range document.MCPServers {
		if strings.TrimSpace(serverName) == "" {
			return "", fmt.Errorf("%w: mcp profile server name cannot be empty", ErrMCPProfileInvalidConfig)
		}
		if err := validateMCPServerConfig(serverName, serverConfig); err != nil {
			return "", fmt.Errorf("%w: %v", ErrMCPProfileInvalidConfig, err)
		}
		return serverName, nil
	}
	return "", fmt.Errorf("%w: mcp profile must define exactly one mcpServers entry", ErrMCPProfileInvalidConfig)
}

func validateMCPServerConfig(serverName string, serverConfig map[string]any) error {
	transportType := "stdio"
	if rawType, ok := serverConfig["type"]; ok {
		value, ok := rawType.(string)
		if !ok || strings.TrimSpace(value) == "" {
			return fmt.Errorf("mcp profile %q type must be a non-empty string", serverName)
		}
		transportType = strings.TrimSpace(value)
	}

	// Keep the gateway validation aligned with the runtime transport contract so
	// malformed profile JSON cannot be saved and fail later as an agent-runtime
	// startup issue.
	switch transportType {
	case "http", "sse":
		if strings.TrimSpace(stringValue(serverConfig["url"])) == "" {
			return fmt.Errorf("mcp profile %q with type %q requires url", serverName, transportType)
		}
	case "stdio":
		if strings.TrimSpace(stringValue(serverConfig["command"])) == "" {
			return fmt.Errorf("mcp profile %q with type %q requires command", serverName, transportType)
		}
	default:
		return fmt.Errorf("mcp profile %q has unsupported type %q", serverName, transportType)
	}
	return nil
}

func stringValue(value any) string {
	if rendered, ok := value.(string); ok {
		return rendered
	}
	return ""
}

func parseMCPProfileSourcePath(sourcePath string) (mcpProfileLocation, error) {
	normalized := strings.Trim(strings.TrimSpace(sourcePath), "/")
	if normalized == "" {
		return mcpProfileLocation{}, fmt.Errorf("mcp profile source_path is required")
	}
	switch {
	case strings.HasPrefix(normalized, "system/mcp-profiles/"):
		relativePath, err := normalizeMCPProfileName(strings.TrimPrefix(normalized, "system/mcp-profiles/"))
		if err != nil {
			return mcpProfileLocation{}, err
		}
		return mcpProfileLocation{
			scope:        "system",
			relativePath: relativePath,
		}, nil
	case strings.HasPrefix(normalized, "custom/mcp-profiles/"):
		relativePath, err := normalizeMCPProfileName(strings.TrimPrefix(normalized, "custom/mcp-profiles/"))
		if err != nil {
			return mcpProfileLocation{}, err
		}
		return mcpProfileLocation{
			scope:        "custom",
			relativePath: relativePath,
		}, nil
	default:
		return mcpProfileLocation{}, fmt.Errorf("mcp profile source_path must start with system/mcp-profiles/ or custom/mcp-profiles/")
	}
}

func (s *MCPProfileService) loadMCPProfileFromLocation(location mcpProfileLocation) (*model.MCPProfile, error) {
	profilePath, err := s.fs.GlobalMCPProfileFile(location.scope, location.relativePath)
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(profilePath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("mcp profile %q not found", location.relativePath)
		}
		return nil, err
	}
	serverName, err := validateMCPProfileDocument(data)
	if err != nil {
		return nil, err
	}
	displayName := strings.TrimSuffix(filepath.Base(location.relativePath), filepath.Ext(location.relativePath))
	return &model.MCPProfile{
		Name:       displayName,
		ServerName: serverName,
		Category:   location.scope,
		SourcePath: s.globalMCPProfileSourcePath(location.scope, filepath.ToSlash(location.relativePath)),
		CanEdit:    location.scope == "custom",
		ConfigJSON: json.RawMessage(data),
	}, nil
}

func (s *MCPProfileService) locateUniqueMCPProfileLocation(name string) (mcpProfileLocation, error) {
	locations, err := s.findMCPProfileLocations(name)
	if err != nil {
		return mcpProfileLocation{}, err
	}
	switch len(locations) {
	case 0:
		return mcpProfileLocation{}, fmt.Errorf("mcp profile %q not found", name)
	case 1:
		return locations[0], nil
	default:
		return mcpProfileLocation{}, fmt.Errorf("%w: mcp profile %q is ambiguous across %s", ErrMCPProfileAmbiguous, name, strings.Join(s.findMCPProfileScopes(name), ", "))
	}
}

func (s *MCPProfileService) locateEditableMCPProfileLocation(name string) (mcpProfileLocation, error) {
	location, ok := s.findSingleMCPProfileScopeLocationByName(name, "custom")
	if ok {
		return location, nil
	}
	scopes := s.findMCPProfileScopes(name)
	if len(scopes) == 0 {
		return mcpProfileLocation{}, fmt.Errorf("mcp profile %q not found", name)
	}
	return mcpProfileLocation{}, fmt.Errorf("%w: mcp profile %q is read-only in %s", ErrMCPProfileReadOnly, name, strings.Join(scopes, ", "))
}

func (s *MCPProfileService) findSingleMCPProfileScopeLocationByName(name string, scope string) (mcpProfileLocation, bool) {
	locations, err := s.findMCPProfileLocations(name)
	if err != nil {
		return mcpProfileLocation{}, false
	}
	var matches []mcpProfileLocation
	for _, location := range locations {
		if location.scope == scope {
			matches = append(matches, location)
		}
	}
	if len(matches) != 1 {
		return mcpProfileLocation{}, false
	}
	return matches[0], true
}

func (s *MCPProfileService) findMCPProfileScopes(name string) []string {
	locations, err := s.findMCPProfileLocations(name)
	if err != nil {
		return nil
	}
	scopes := make([]string, 0, len(locations))
	for _, location := range locations {
		scopes = append(scopes, location.scope)
	}
	slices.Sort(scopes)
	return slices.Compact(scopes)
}

func (s *MCPProfileService) findMCPProfileLocations(name string) ([]mcpProfileLocation, error) {
	trimmedName := strings.TrimSpace(name)
	normalizedName := ""
	if trimmedName != "" {
		var err error
		normalizedName, err = normalizeMCPProfileName(trimmedName)
		if err != nil {
			return nil, err
		}
	}
	locations := make([]mcpProfileLocation, 0)
	for _, root := range []struct {
		scope string
		dir   string
	}{
		{scope: "system", dir: s.fs.SystemMCPProfilesDir()},
		{scope: "custom", dir: s.fs.CustomMCPProfilesDir()},
	} {
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
			if filepath.Ext(currentPath) != ".json" {
				return nil
			}
			relativePath, err := filepath.Rel(root.dir, currentPath)
			if err != nil {
				return nil
			}
			normalizedRelativePath, err := normalizeMCPProfileName(filepath.ToSlash(relativePath))
			if err != nil {
				return nil
			}
			if normalizedName != "" && normalizedRelativePath != normalizedName && strings.TrimSuffix(filepath.Base(normalizedRelativePath), ".json") != trimmedName {
				return nil
			}
			locations = append(locations, mcpProfileLocation{
				scope:        root.scope,
				relativePath: normalizedRelativePath,
			})
			return nil
		})
		if err != nil {
			return nil, err
		}
	}
	slices.SortFunc(locations, func(a, b mcpProfileLocation) int {
		if byScope := strings.Compare(a.scope, b.scope); byScope != 0 {
			return byScope
		}
		return strings.Compare(a.relativePath, b.relativePath)
	})
	return locations, nil
}

func (s *MCPProfileService) globalMCPProfileSourcePath(scope, relativePath string) string {
	cleanScope := strings.Trim(strings.TrimSpace(scope), "/")
	cleanRelativePath := strings.Trim(strings.TrimSpace(relativePath), "/")
	return filepath.ToSlash(filepath.Join(cleanScope, "mcp-profiles", cleanRelativePath))
}
