package skillfs

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const DescriptionI18nFileName = "skill.i18n.json"

const (
	DescriptionLocaleEnUS = "en-US"
	DescriptionLocaleZhCN = "zh-CN"
)

var supportedDescriptionLocales = []string{
	DescriptionLocaleEnUS,
	DescriptionLocaleZhCN,
}

type DescriptionI18n map[string]string

type descriptionI18nFile struct {
	Version       int               `json:"version"`
	DefaultLocale string            `json:"default_locale,omitempty"`
	Description   map[string]string `json:"description"`
}

func normalizeDescriptionI18n(values map[string]string) DescriptionI18n {
	if len(values) == 0 {
		return nil
	}

	normalized := DescriptionI18n{}
	for _, locale := range supportedDescriptionLocales {
		text := strings.TrimSpace(values[locale])
		if text == "" {
			continue
		}
		normalized[locale] = text
	}

	if len(normalized) == 0 {
		return nil
	}
	return normalized
}

func chooseDefaultDescriptionLocale(values DescriptionI18n) string {
	if len(values) == 0 {
		return ""
	}
	if _, ok := values[DescriptionLocaleZhCN]; ok {
		return DescriptionLocaleZhCN
	}
	if _, ok := values[DescriptionLocaleEnUS]; ok {
		return DescriptionLocaleEnUS
	}

	locales := make([]string, 0, len(values))
	for locale := range values {
		locales = append(locales, locale)
	}
	sort.Strings(locales)
	return locales[0]
}

func LoadDescriptionI18nFile(skillDir string) (DescriptionI18n, error) {
	data, err := os.ReadFile(filepath.Join(skillDir, DescriptionI18nFileName))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}

	var payload descriptionI18nFile
	if err := json.Unmarshal(data, &payload); err != nil {
		return nil, err
	}

	return normalizeDescriptionI18n(payload.Description), nil
}

func WriteDescriptionI18nFile(skillDir string, values map[string]string) error {
	path := filepath.Join(skillDir, DescriptionI18nFileName)
	normalized := normalizeDescriptionI18n(values)
	if len(normalized) == 0 {
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			return err
		}
		return nil
	}

	payload := descriptionI18nFile{
		Version:       1,
		DefaultLocale: chooseDefaultDescriptionLocale(normalized),
		Description:   map[string]string(normalized),
	}

	data, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')

	if err := os.MkdirAll(skillDir, 0755); err != nil {
		return err
	}
	return os.WriteFile(path, data, 0644)
}
