package threadartifacts

import (
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"slices"
	"strings"

	"github.com/openagents/gateway/pkg/storage"
)

const threadVirtualPathPrefix = "/mnt/user-data"

func shouldSkipOutputArtifactEntry(entry fs.DirEntry, outputsDir string, currentPath string) bool {
	name := entry.Name()
	if entry.IsDir() {
		return currentPath != outputsDir && strings.HasPrefix(name, ".")
	}

	return strings.HasPrefix(name, ".") || strings.HasSuffix(name, ".preview.pdf")
}

// ListOutputArtifacts mirrors the workspace artifact discovery contract by
// scanning persisted thread outputs instead of trusting only graph state.
// This keeps generated files visible even when the model forgets `present_files`.
func ListOutputArtifacts(storageFS *storage.FS, threadID string) ([]string, error) {
	outputsDir := filepath.Join(storageFS.ThreadUserDataDir(threadID), "outputs")
	info, err := os.Stat(outputsDir)
	if err != nil {
		if os.IsNotExist(err) {
			return []string{}, nil
		}
		return nil, err
	}
	if !info.IsDir() {
		return []string{}, nil
	}

	artifacts := make([]string, 0)
	err = filepath.WalkDir(outputsDir, func(currentPath string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}

		if shouldSkipOutputArtifactEntry(entry, outputsDir, currentPath) {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if entry.IsDir() {
			return nil
		}

		relativePath, err := filepath.Rel(outputsDir, currentPath)
		if err != nil {
			return err
		}
		artifacts = append(
			artifacts,
			path.Join(threadVirtualPathPrefix, "outputs", filepath.ToSlash(relativePath)),
		)
		return nil
	})
	if err != nil {
		return nil, err
	}

	slices.Sort(artifacts)
	return artifacts, nil
}
