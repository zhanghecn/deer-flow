package service

import (
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"github.com/openagents/gateway/internal/model"
	"github.com/openagents/gateway/pkg/storage"
)

const authoringVirtualPathPrefix = "/mnt/user-data/authoring"

type AuthoringWorkspaceService struct {
	fs       *storage.FS
	skillSvc *SkillService
}

func NewAuthoringWorkspaceService(fs *storage.FS) *AuthoringWorkspaceService {
	return &AuthoringWorkspaceService{
		fs:       fs,
		skillSvc: NewSkillService(fs),
	}
}

func (s *AuthoringWorkspaceService) StageAgentDraft(threadID string, agentName string, agentStatus string) (string, []model.AuthoringFileEntry, error) {
	status := normalizeAuthoringAgentStatus(agentStatus)
	sourceDir := s.fs.AgentDir(agentName, status)
	if info, err := os.Stat(sourceDir); err != nil || !info.IsDir() {
		return "", nil, fmt.Errorf("agent %q (%s) not found", agentName, status)
	}

	draftDir := filepath.Join(s.fs.ThreadUserDataDir(threadID), "authoring", "agents", status, agentName)
	// Drafts are thread-local working copies so browser edits never mutate the
	// canonical archive until an explicit save action copies them back.
	if info, err := os.Stat(draftDir); err != nil || !info.IsDir() {
		_ = os.RemoveAll(draftDir)
		if err := s.fs.CopyDir(sourceDir, draftDir); err != nil {
			return "", nil, err
		}
	}
	return s.listDraftDirectory(threadID, draftDir)
}

func (s *AuthoringWorkspaceService) StageSkillDraft(threadID string, skillName string, sourcePath string) (string, []model.AuthoringFileEntry, error) {
	draftDir := filepath.Join(s.fs.ThreadUserDataDir(threadID), "authoring", "skills", skillName)
	if info, err := os.Stat(draftDir); err == nil && info.IsDir() {
		return s.listDraftDirectory(threadID, draftDir)
	}

	_ = os.RemoveAll(draftDir)
	sourceDir, err := s.resolveSkillDraftSourceDir(skillName, sourcePath)
	if err != nil {
		return "", nil, err
	}
	if sourceDir == "" {
		if err := os.MkdirAll(draftDir, 0o755); err != nil {
			return "", nil, err
		}
		skillMD, err := ensureSkillFrontmatter(skillName, "", "")
		if err != nil {
			return "", nil, err
		}
		if err := os.WriteFile(filepath.Join(draftDir, "SKILL.md"), []byte(skillMD), 0o644); err != nil {
			return "", nil, err
		}
	} else {
		if err := s.fs.CopyDir(sourceDir, draftDir); err != nil {
			return "", nil, err
		}
	}

	return s.listDraftDirectory(threadID, draftDir)
}

func (s *AuthoringWorkspaceService) ListDraftFiles(threadID string, virtualPath string) ([]model.AuthoringFileEntry, error) {
	actualPath, err := s.resolveDraftVirtualPath(threadID, virtualPath)
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(actualPath)
	if err != nil {
		return nil, err
	}

	items := make([]model.AuthoringFileEntry, 0, len(entries))
	for _, entry := range entries {
		items = append(items, model.AuthoringFileEntry{
			Name:  entry.Name(),
			Path:  s.virtualAuthoringPath(threadID, filepath.Join(actualPath, entry.Name())),
			IsDir: entry.IsDir(),
		})
	}
	slices.SortFunc(items, func(a, b model.AuthoringFileEntry) int {
		if a.IsDir != b.IsDir {
			if a.IsDir {
				return -1
			}
			return 1
		}
		return strings.Compare(a.Name, b.Name)
	})
	return items, nil
}

func (s *AuthoringWorkspaceService) ReadDraftFile(threadID string, virtualPath string) (string, error) {
	actualPath, err := s.resolveDraftVirtualPath(threadID, virtualPath)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(actualPath)
	if err != nil {
		return "", err
	}
	if info.IsDir() {
		return "", fmt.Errorf("path %q is a directory", virtualPath)
	}

	data, err := os.ReadFile(actualPath)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func (s *AuthoringWorkspaceService) WriteDraftFile(threadID string, virtualPath string, content string) error {
	actualPath, err := s.resolveDraftVirtualPath(threadID, virtualPath)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(actualPath), 0o755); err != nil {
		return err
	}
	return os.WriteFile(actualPath, []byte(content), 0o644)
}

func (s *AuthoringWorkspaceService) SaveAgentDraft(threadID string, agentName string, agentStatus string) (string, error) {
	status := normalizeAuthoringAgentStatus(agentStatus)
	draftDir := filepath.Join(s.fs.ThreadUserDataDir(threadID), "authoring", "agents", status, agentName)
	if info, err := os.Stat(draftDir); err != nil || !info.IsDir() {
		return "", fmt.Errorf("agent draft %q (%s) not found", agentName, status)
	}

	targetDir := s.fs.AgentDir(agentName, status)
	_ = os.RemoveAll(targetDir)
	if err := s.fs.CopyDir(draftDir, targetDir); err != nil {
		return "", err
	}
	return s.virtualAuthoringPath(threadID, draftDir), nil
}

func (s *AuthoringWorkspaceService) SaveSkillDraft(threadID string, skillName string) (string, error) {
	draftDir := filepath.Join(s.fs.ThreadUserDataDir(threadID), "authoring", "skills", skillName)
	if info, err := os.Stat(draftDir); err != nil || !info.IsDir() {
		return "", fmt.Errorf("skill draft %q not found", skillName)
	}

	targetDir := s.fs.GlobalSkillDir("custom", skillName)
	_ = os.RemoveAll(targetDir)
	if err := s.fs.CopyDir(draftDir, targetDir); err != nil {
		return "", err
	}
	return s.virtualAuthoringPath(threadID, draftDir), nil
}

func (s *AuthoringWorkspaceService) resolveSkillDraftSourceDir(skillName string, sourcePath string) (string, error) {
	if trimmedSourcePath := strings.TrimSpace(sourcePath); trimmedSourcePath != "" {
		location, err := parseSkillDocumentSourcePath(trimmedSourcePath)
		if err != nil {
			return "", err
		}
		return s.fs.GlobalSkillDir(location.scope, location.relativeDir), nil
	}
	if location, ok := s.skillSvc.findSingleScopeLocationByName(skillName, "custom"); ok {
		return s.fs.GlobalSkillDir(location.scope, location.relativeDir), nil
	}
	location, err := s.skillSvc.locateUniqueSkillLocation(skillName)
	if err == nil {
		return s.fs.GlobalSkillDir(location.scope, location.relativeDir), nil
	}
	if strings.Contains(err.Error(), "not found") {
		return "", nil
	}
	return "", err
}

func (s *AuthoringWorkspaceService) listDraftDirectory(threadID string, actualPath string) (string, []model.AuthoringFileEntry, error) {
	rootPath := s.virtualAuthoringPath(threadID, actualPath)
	items, err := s.ListDraftFiles(threadID, rootPath)
	if err != nil {
		return "", nil, err
	}
	return rootPath, items, nil
}

func (s *AuthoringWorkspaceService) resolveDraftVirtualPath(threadID string, virtualPath string) (string, error) {
	cleanVirtualPath := strings.TrimSpace(virtualPath)
	if cleanVirtualPath == "" {
		cleanVirtualPath = authoringVirtualPathPrefix
	}
	if !strings.HasPrefix(cleanVirtualPath, authoringVirtualPathPrefix) {
		return "", fmt.Errorf("path must stay under %s", authoringVirtualPathPrefix)
	}

	threadUserDataDir := filepath.Clean(s.fs.ThreadUserDataDir(threadID))
	authoringRoot := filepath.Join(threadUserDataDir, "authoring")
	relativePath := strings.TrimPrefix(cleanVirtualPath, "/mnt/user-data")
	actualPath := filepath.Clean(filepath.Join(threadUserDataDir, relativePath))
	if actualPath != authoringRoot && !strings.HasPrefix(actualPath, authoringRoot+string(os.PathSeparator)) {
		return "", fmt.Errorf("access denied: authoring path traversal detected")
	}
	return actualPath, nil
}

func (s *AuthoringWorkspaceService) virtualAuthoringPath(threadID string, actualPath string) string {
	threadUserDataDir := filepath.Clean(s.fs.ThreadUserDataDir(threadID))
	relativePath, err := filepath.Rel(threadUserDataDir, actualPath)
	if err != nil {
		return authoringVirtualPathPrefix
	}
	return "/mnt/user-data/" + filepath.ToSlash(relativePath)
}

func normalizeAuthoringAgentStatus(status string) string {
	if strings.TrimSpace(status) == "prod" {
		return "prod"
	}
	return "dev"
}
