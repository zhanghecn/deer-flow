package uploadutil

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
)

var markdownConvertibleExtensions = map[string]struct{}{
	".pdf":  {},
	".ppt":  {},
	".pptx": {},
	".xls":  {},
	".xlsx": {},
	".doc":  {},
	".docx": {},
}

var (
	legacyDocTopHeadingPattern = regexp.MustCompile(
		`^(?:第[0-9一二三四五六七八九十百千万]+[期章节篇部分卷]|[一二三四五六七八九十百千万]+[、.．])`,
	)
	legacyDocSubHeadingPattern = regexp.MustCompile(
		`^(?:\d+[、.．)]|[（(]?[0-9一二三四五六七八九十百千万]+[)）])`,
	)
	legacyDocColonHeadingPattern = regexp.MustCompile(`^[^。！？；]{2,24}[：:]$`)
)

func IsMarkdownConvertible(filename string) bool {
	_, ok := markdownConvertibleExtensions[strings.ToLower(filepath.Ext(filename))]
	return ok
}

func MarkdownCompanionName(filename string) string {
	return strings.TrimSuffix(filename, filepath.Ext(filename)) + ".md"
}

func OriginalConvertibleName(markdownFilename string, available map[string]os.DirEntry) string {
	stem := strings.TrimSuffix(markdownFilename, filepath.Ext(markdownFilename))
	for extension := range markdownConvertibleExtensions {
		candidate := stem + extension
		if _, ok := available[candidate]; ok {
			return candidate
		}
	}
	return ""
}

func markitdownBinary() (string, error) {
	if configured := strings.TrimSpace(os.Getenv("OPENAGENTS_MARKITDOWN_BIN")); configured != "" {
		return configured, nil
	}
	if resolved, err := exec.LookPath("markitdown"); err == nil {
		return resolved, nil
	}
	return bundledBinary("markitdown")
}

func MarkitdownBinary() (string, error) {
	return markitdownBinary()
}

func antiwordBinary() (string, error) {
	if configured := strings.TrimSpace(os.Getenv("OPENAGENTS_ANTIWORD_BIN")); configured != "" {
		return configured, nil
	}
	return exec.LookPath("antiword")
}

func bundledBinary(binaryName string) (string, error) {
	cwd, err := os.Getwd()
	if err != nil {
		return "", fmt.Errorf("resolve working directory: %w", err)
	}
	for dir := cwd; dir != "" && dir != filepath.Dir(dir); dir = filepath.Dir(dir) {
		for _, relative := range []string{
			filepath.Join("backend", ".venv", "bin", binaryName),
			filepath.Join("backend", "agents", ".venv", "bin", binaryName),
		} {
			candidate := filepath.Join(dir, relative)
			info, statErr := os.Stat(candidate)
			if statErr != nil || info.IsDir() {
				continue
			}
			if info.Mode()&0o111 == 0 {
				continue
			}
			return candidate, nil
		}
	}
	return "", fmt.Errorf("resolve %s binary: not found in PATH or repo virtualenvs", binaryName)
}

func writeMarkdownCompanion(markdownPath string, content string) error {
	normalized := strings.ReplaceAll(content, "\r\n", "\n")
	trimmed := strings.TrimSpace(normalized)
	if trimmed == "" {
		return fmt.Errorf("empty markdown content")
	}
	return os.WriteFile(markdownPath, []byte(trimmed+"\n"), 0o644)
}

func legacyDocTextToMarkdown(content string) string {
	lines := strings.Split(strings.ReplaceAll(content, "\r\n", "\n"), "\n")
	parts := make([]string, 0, len(lines)*2)
	wroteTitle := false
	appendBlank := func() {
		if len(parts) == 0 || parts[len(parts)-1] == "" {
			return
		}
		parts = append(parts, "")
	}
	for _, rawLine := range lines {
		line := strings.TrimSpace(strings.ReplaceAll(rawLine, "\u00a0", " "))
		if line == "" {
			appendBlank()
			continue
		}
		if !wroteTitle {
			parts = append(parts, "# "+line, "")
			wroteTitle = true
			continue
		}
		switch {
		case legacyDocTopHeadingPattern.MatchString(line):
			parts = append(parts, "## "+line, "")
		case legacyDocSubHeadingPattern.MatchString(line), legacyDocColonHeadingPattern.MatchString(line):
			parts = append(parts, "### "+line, "")
		default:
			parts = append(parts, line)
		}
	}
	return strings.Join(parts, "\n")
}

func convertDocFileToMarkdown(filePath string, markdownPath string) error {
	binary, err := antiwordBinary()
	if err != nil {
		return fmt.Errorf("resolve antiword binary: %w", err)
	}
	command := exec.Command(binary, filePath)
	output, err := command.CombinedOutput()
	if err != nil {
		return fmt.Errorf("antiword conversion failed: %w: %s", err, strings.TrimSpace(string(output)))
	}
	if err := writeMarkdownCompanion(markdownPath, legacyDocTextToMarkdown(string(output))); err != nil {
		return fmt.Errorf("persist antiword markdown companion: %w", err)
	}
	return nil
}

// ConvertFileToMarkdown keeps upload conversion behavior identical across the
// workspace upload surface and the public API upload surface. Without this
// shared helper, the same file could be readable in one ingress path and opaque
// in the other.
func ConvertFileToMarkdown(filePath string) (string, error) {
	markdownPath := strings.TrimSuffix(filePath, filepath.Ext(filePath)) + ".md"
	var errs []string

	if binary, err := markitdownBinary(); err != nil {
		errs = append(errs, err.Error())
	} else {
		command := exec.Command(binary, filePath, "-o", markdownPath)
		output, err := command.CombinedOutput()
		if err == nil {
			return markdownPath, nil
		}
		errs = append(
			errs,
			fmt.Sprintf("markitdown conversion failed: %v: %s", err, strings.TrimSpace(string(output))),
		)
	}

	if strings.EqualFold(filepath.Ext(filePath), ".doc") {
		if err := convertDocFileToMarkdown(filePath, markdownPath); err == nil {
			return markdownPath, nil
		} else {
			errs = append(errs, err.Error())
		}
	}

	return "", errors.New(strings.Join(errs, "; "))
}
