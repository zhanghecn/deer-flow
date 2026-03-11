package skillfs

import (
	"fmt"
	"os"
	"strings"

	"gopkg.in/yaml.v3"
)

type Frontmatter struct {
	Name        string `yaml:"name"`
	Description string `yaml:"description"`
	License     string `yaml:"license"`
}

func ParseFrontmatterFile(path string) (Frontmatter, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return Frontmatter{}, err
	}
	return ParseFrontmatter(string(data))
}

func ParseFrontmatter(skillMD string) (Frontmatter, error) {
	if !strings.HasPrefix(skillMD, "---\n") {
		return Frontmatter{}, fmt.Errorf("missing YAML frontmatter")
	}

	rest := strings.TrimPrefix(skillMD, "---\n")
	end := strings.Index(rest, "\n---")
	if end < 0 {
		return Frontmatter{}, fmt.Errorf("invalid YAML frontmatter")
	}

	var meta Frontmatter
	if err := yaml.Unmarshal([]byte(rest[:end]), &meta); err != nil {
		return Frontmatter{}, err
	}
	meta.Name = strings.TrimSpace(meta.Name)
	meta.Description = strings.TrimSpace(meta.Description)
	meta.License = strings.TrimSpace(meta.License)
	if meta.Name == "" {
		return Frontmatter{}, fmt.Errorf("skill name missing in frontmatter")
	}
	return meta, nil
}
