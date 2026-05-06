package service

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"github.com/openagents/gateway/internal/model"
	"github.com/openagents/gateway/pkg/storage"
)

const authoringVirtualPathPrefix = "/mnt/user-data/authoring"

type authoringDraftSourceMetadata struct {
	SourceFingerprint string `json:"source_fingerprint"`
	DraftFingerprint  string `json:"draft_fingerprint"`
}

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

func (s *AuthoringWorkspaceService) StageAgentDraft(userID string, threadID string, agentName string, agentStatus string, overwrite bool) (string, []model.AuthoringFileEntry, error) {
	status := normalizeAuthoringAgentStatus(agentStatus)
	sourceDir := s.fs.AgentDir(agentName, status)
	if info, err := os.Stat(sourceDir); err != nil || !info.IsDir() {
		return "", nil, fmt.Errorf("agent %q (%s) not found", agentName, status)
	}

	draftDir := filepath.Join(s.fs.ThreadUserDataDirForUser(userID, threadID), "authoring", "agents", status, agentName)
	// Drafts are thread-local working copies so browser edits never mutate the
	// canonical archive until an explicit save action copies them back.
	if overwrite {
		// Settings saves are an explicit archive-level update. When the UI asks
		// to overwrite, keep the same thread-local virtual path but restage it
		// from the canonical archive so copied skills and config stay aligned.
		_ = os.RemoveAll(draftDir)
		if err := s.copyAgentArchiveIntoDraft(sourceDir, draftDir); err != nil {
			return "", nil, err
		}
	} else if info, err := os.Stat(draftDir); err != nil || !info.IsDir() {
		_ = os.RemoveAll(draftDir)
		if err := s.copyAgentArchiveIntoDraft(sourceDir, draftDir); err != nil {
			return "", nil, err
		}
	} else if err := s.refreshAgentDraftIfArchiveChanged(sourceDir, draftDir); err != nil {
		return "", nil, err
	}
	return s.listDraftDirectory(userID, threadID, draftDir)
}

func (s *AuthoringWorkspaceService) StageSkillDraft(userID string, threadID string, skillName string, sourcePath string) (string, []model.AuthoringFileEntry, error) {
	draftDir := filepath.Join(s.fs.ThreadUserDataDirForUser(userID, threadID), "authoring", "skills", skillName)
	if info, err := os.Stat(draftDir); err == nil && info.IsDir() {
		return s.listDraftDirectory(userID, threadID, draftDir)
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

	return s.listDraftDirectory(userID, threadID, draftDir)
}

func (s *AuthoringWorkspaceService) ListDraftFiles(userID string, threadID string, virtualPath string) ([]model.AuthoringFileEntry, error) {
	actualPath, err := s.resolveDraftVirtualPath(userID, threadID, virtualPath)
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
			Path:  s.virtualAuthoringPath(userID, threadID, filepath.Join(actualPath, entry.Name())),
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

func (s *AuthoringWorkspaceService) ReadDraftFile(userID string, threadID string, virtualPath string) (string, error) {
	actualPath, err := s.resolveDraftVirtualPath(userID, threadID, virtualPath)
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

func (s *AuthoringWorkspaceService) WriteDraftFile(userID string, threadID string, virtualPath string, content string) error {
	actualPath, err := s.resolveDraftVirtualPath(userID, threadID, virtualPath)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(actualPath), 0o755); err != nil {
		return err
	}
	return os.WriteFile(actualPath, []byte(content), 0o644)
}

func (s *AuthoringWorkspaceService) DeleteDraftPath(userID string, threadID string, virtualPath string) error {
	actualPath, err := s.resolveDraftVirtualPath(userID, threadID, virtualPath)
	if err != nil {
		return err
	}
	if err := rejectAuthoringDraftRootDelete(s.fs.ThreadUserDataDirForUser(userID, threadID), actualPath); err != nil {
		return err
	}
	if _, err := os.Stat(actualPath); err != nil {
		return err
	}
	return os.RemoveAll(actualPath)
}

func (s *AuthoringWorkspaceService) SaveAgentDraft(userID string, threadID string, agentName string, agentStatus string) (string, error) {
	status := normalizeAuthoringAgentStatus(agentStatus)
	draftDir := filepath.Join(s.fs.ThreadUserDataDirForUser(userID, threadID), "authoring", "agents", status, agentName)
	if info, err := os.Stat(draftDir); err != nil || !info.IsDir() {
		return "", fmt.Errorf("agent draft %q (%s) not found", agentName, status)
	}

	targetDir := s.fs.AgentDir(agentName, status)
	_ = os.RemoveAll(targetDir)
	if err := s.fs.CopyDir(draftDir, targetDir); err != nil {
		return "", err
	}
	return s.virtualAuthoringPath(userID, threadID, draftDir), nil
}

func (s *AuthoringWorkspaceService) copyAgentArchiveIntoDraft(sourceDir string, draftDir string) error {
	if err := s.fs.CopyDir(sourceDir, draftDir); err != nil {
		return err
	}
	return writeAuthoringSourceMetadata(sourceDir, draftDir)
}

func (s *AuthoringWorkspaceService) refreshAgentDraftIfArchiveChanged(sourceDir string, draftDir string) error {
	sourceFingerprint, err := fingerprintDirectory(sourceDir)
	if err != nil {
		return err
	}
	draftFingerprint, err := fingerprintDirectory(draftDir)
	if err != nil {
		return err
	}

	metadata, hasMetadata, err := readAuthoringSourceMetadata(draftDir)
	if err != nil {
		return err
	}
	if !hasMetadata {
		shouldRefresh, err := legacyDraftLooksOlderThanSource(sourceDir, draftDir)
		if err != nil {
			return err
		}
		if shouldRefresh {
			// Older authoring drafts did not record their source fingerprint, so
			// a source-newer-than-draft mtime is the safest migration signal.
			_ = os.RemoveAll(draftDir)
			return s.copyAgentArchiveIntoDraft(sourceDir, draftDir)
		}
		return writeAuthoringSourceMetadataValues(draftDir, sourceFingerprint, draftFingerprint)
	}
	if metadata.SourceFingerprint == sourceFingerprint {
		return nil
	}
	if metadata.DraftFingerprint != draftFingerprint {
		// Preserve local draft edits over archive refreshes; saving remains an
		// explicit author action, so this avoids clobbering in-progress edits.
		return nil
	}
	_ = os.RemoveAll(draftDir)
	return s.copyAgentArchiveIntoDraft(sourceDir, draftDir)
}

func (s *AuthoringWorkspaceService) SaveSkillDraft(userID string, threadID string, skillName string) (string, error) {
	draftDir := filepath.Join(s.fs.ThreadUserDataDirForUser(userID, threadID), "authoring", "skills", skillName)
	if info, err := os.Stat(draftDir); err != nil || !info.IsDir() {
		return "", fmt.Errorf("skill draft %q not found", skillName)
	}

	targetDir := s.fs.GlobalSkillDir("custom", skillName)
	_ = os.RemoveAll(targetDir)
	if err := s.fs.CopyDir(draftDir, targetDir); err != nil {
		return "", err
	}
	return s.virtualAuthoringPath(userID, threadID, draftDir), nil
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

func (s *AuthoringWorkspaceService) listDraftDirectory(userID string, threadID string, actualPath string) (string, []model.AuthoringFileEntry, error) {
	rootPath := s.virtualAuthoringPath(userID, threadID, actualPath)
	items, err := s.ListDraftFiles(userID, threadID, rootPath)
	if err != nil {
		return "", nil, err
	}
	return rootPath, items, nil
}

func (s *AuthoringWorkspaceService) resolveDraftVirtualPath(userID string, threadID string, virtualPath string) (string, error) {
	cleanVirtualPath := strings.TrimSpace(virtualPath)
	if cleanVirtualPath == "" {
		cleanVirtualPath = authoringVirtualPathPrefix
	}
	if !strings.HasPrefix(cleanVirtualPath, authoringVirtualPathPrefix) {
		return "", fmt.Errorf("path must stay under %s", authoringVirtualPathPrefix)
	}

	// Draft workspaces are tenant-scoped on disk while keeping browser-facing
	// authoring paths inside `/mnt/user-data/authoring`.
	threadUserDataDir := filepath.Clean(s.fs.ThreadUserDataDirForUser(userID, threadID))
	authoringRoot := filepath.Join(threadUserDataDir, "authoring")
	relativePath := strings.TrimPrefix(cleanVirtualPath, "/mnt/user-data")
	actualPath := filepath.Clean(filepath.Join(threadUserDataDir, relativePath))
	if actualPath != authoringRoot && !strings.HasPrefix(actualPath, authoringRoot+string(os.PathSeparator)) {
		return "", fmt.Errorf("access denied: authoring path traversal detected")
	}
	return actualPath, nil
}

func (s *AuthoringWorkspaceService) virtualAuthoringPath(userID string, threadID string, actualPath string) string {
	threadUserDataDir := filepath.Clean(s.fs.ThreadUserDataDirForUser(userID, threadID))
	relativePath, err := filepath.Rel(threadUserDataDir, actualPath)
	if err != nil {
		return authoringVirtualPathPrefix
	}
	return "/mnt/user-data/" + filepath.ToSlash(relativePath)
}

func rejectAuthoringDraftRootDelete(threadUserDataDir string, actualPath string) error {
	authoringRoot := filepath.Join(filepath.Clean(threadUserDataDir), "authoring")
	relativePath, err := filepath.Rel(authoringRoot, actualPath)
	if err != nil {
		return err
	}
	if relativePath == "." {
		return fmt.Errorf("cannot delete authoring root")
	}

	// The workbench may delete files and nested directories, but deleting an
	// entire authoring group or staged agent/skill root would bypass the
	// explicit save/discard lifecycle and orphan the source fingerprint metadata.
	parts := strings.Split(filepath.ToSlash(relativePath), "/")
	if parts[0] == "agents" && len(parts) <= 3 {
		return fmt.Errorf("cannot delete agent draft root")
	}
	if parts[0] == "skills" && len(parts) <= 2 {
		return fmt.Errorf("cannot delete skill draft root")
	}
	return nil
}

func normalizeAuthoringAgentStatus(status string) string {
	if strings.TrimSpace(status) == "prod" {
		return "prod"
	}
	return "dev"
}

func authoringSourceMetadataPath(draftDir string) string {
	return filepath.Join(filepath.Dir(draftDir), "."+filepath.Base(draftDir)+".source.json")
}

func readAuthoringSourceMetadata(draftDir string) (authoringDraftSourceMetadata, bool, error) {
	data, err := os.ReadFile(authoringSourceMetadataPath(draftDir))
	if err != nil {
		if os.IsNotExist(err) {
			return authoringDraftSourceMetadata{}, false, nil
		}
		return authoringDraftSourceMetadata{}, false, err
	}
	var metadata authoringDraftSourceMetadata
	if err := json.Unmarshal(data, &metadata); err != nil {
		return authoringDraftSourceMetadata{}, false, err
	}
	return metadata, true, nil
}

func writeAuthoringSourceMetadata(sourceDir string, draftDir string) error {
	sourceFingerprint, err := fingerprintDirectory(sourceDir)
	if err != nil {
		return err
	}
	draftFingerprint, err := fingerprintDirectory(draftDir)
	if err != nil {
		return err
	}
	return writeAuthoringSourceMetadataValues(draftDir, sourceFingerprint, draftFingerprint)
}

func writeAuthoringSourceMetadataValues(draftDir string, sourceFingerprint string, draftFingerprint string) error {
	metadata := authoringDraftSourceMetadata{
		SourceFingerprint: sourceFingerprint,
		DraftFingerprint:  draftFingerprint,
	}
	data, err := json.MarshalIndent(metadata, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(authoringSourceMetadataPath(draftDir), append(data, '\n'), 0o644)
}

func fingerprintDirectory(root string) (string, error) {
	hash := sha256.New()
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		relativePath, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		hash.Write([]byte(filepath.ToSlash(relativePath)))
		hash.Write([]byte{0})
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		hash.Write(data)
		hash.Write([]byte{0})
		return nil
	})
	if err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func legacyDraftLooksOlderThanSource(sourceDir string, draftDir string) (bool, error) {
	sourceInfo, err := newestFileModTime(sourceDir)
	if err != nil {
		return false, err
	}
	draftInfo, err := newestFileModTime(draftDir)
	if err != nil {
		return false, err
	}
	return sourceInfo.ModTime().After(draftInfo.ModTime()), nil
}

func newestFileModTime(root string) (fs.FileInfo, error) {
	var newest fs.FileInfo
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
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
		if newest == nil || info.ModTime().After(newest.ModTime()) {
			newest = info
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if newest == nil {
		return nil, fmt.Errorf("directory %q has no files", root)
	}
	return newest, nil
}
