package service

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/openagents/gateway/internal/model"
	"github.com/openagents/gateway/internal/skillfs"
	"github.com/openagents/gateway/pkg/storage"
)

func TestSkillServiceCreateEnsuresFrontmatterInStoreDev(t *testing.T) {
	t.Parallel()

	baseDir := filepath.Join(t.TempDir(), ".openagents")
	svc := NewSkillService(storage.NewFS(baseDir))

	skill, err := svc.Create(context.Background(), model.CreateSkillRequest{
		Name:        "contract-checker",
		Description: "Checks contract clauses",
		SkillMD:     "Skill body",
	}, uuid.Nil)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	if skill.Status != "dev" {
		t.Fatalf("skill.Status = %q, want %q", skill.Status, "dev")
	}

	skillFile := filepath.Join(baseDir, "skills", "store", "dev", "contract-checker", "SKILL.md")
	data, err := os.ReadFile(skillFile)
	if err != nil {
		t.Fatalf("ReadFile() error = %v", err)
	}
	text := string(data)
	if !strings.Contains(text, "name: contract-checker") {
		t.Fatalf("skill file missing name frontmatter: %s", text)
	}
	if !strings.Contains(text, "description: Checks contract clauses") {
		t.Fatalf("skill file missing description frontmatter: %s", text)
	}
}

func TestSkillServicePublishCopiesDevSkillToProd(t *testing.T) {
	t.Parallel()

	baseDir := filepath.Join(t.TempDir(), ".openagents")
	svc := NewSkillService(storage.NewFS(baseDir))

	_, err := svc.Create(context.Background(), model.CreateSkillRequest{
		Name:        "risk-score",
		Description: "Rates risk",
		SkillMD:     "Skill body",
	}, uuid.Nil)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	skill, err := svc.Publish(context.Background(), "risk-score")
	if err != nil {
		t.Fatalf("Publish() error = %v", err)
	}

	if skill.Status != "prod" {
		t.Fatalf("skill.Status = %q, want %q", skill.Status, "prod")
	}

	prodFile := filepath.Join(baseDir, "skills", "store", "prod", "risk-score", "SKILL.md")
	if _, err := os.Stat(prodFile); err != nil {
		t.Fatalf("expected prod skill file at %s: %v", prodFile, err)
	}
}

func TestSkillServiceCreateWritesDescriptionI18n(t *testing.T) {
	t.Parallel()

	baseDir := filepath.Join(t.TempDir(), ".openagents")
	svc := NewSkillService(storage.NewFS(baseDir))

	skill, err := svc.Create(context.Background(), model.CreateSkillRequest{
		Name:        "bilingual-skill",
		Description: "Original fallback description",
		DescriptionI18n: map[string]string{
			"en-US": "English description",
			"zh-CN": "中文描述",
			"fr-FR": "should be ignored",
		},
		SkillMD: "Skill body",
	}, uuid.Nil)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	if got := skill.DescriptionI18n["en-US"]; got != "English description" {
		t.Fatalf("skill.DescriptionI18n[en-US] = %q, want %q", got, "English description")
	}
	if got := skill.DescriptionI18n["zh-CN"]; got != "中文描述" {
		t.Fatalf("skill.DescriptionI18n[zh-CN] = %q, want %q", got, "中文描述")
	}
	if _, ok := skill.DescriptionI18n["fr-FR"]; ok {
		t.Fatal("unexpected unsupported locale preserved in DescriptionI18n")
	}

	values, err := skillfs.LoadDescriptionI18nFile(
		filepath.Join(baseDir, "skills", "store", "dev", "bilingual-skill"),
	)
	if err != nil {
		t.Fatalf("LoadDescriptionI18nFile() error = %v", err)
	}
	if got := values["en-US"]; got != "English description" {
		t.Fatalf("loaded en-US description = %q, want %q", got, "English description")
	}
	if got := values["zh-CN"]; got != "中文描述" {
		t.Fatalf("loaded zh-CN description = %q, want %q", got, "中文描述")
	}
}

func TestSkillServiceUpdateClearsDescriptionI18nFileWhenEmpty(t *testing.T) {
	t.Parallel()

	baseDir := filepath.Join(t.TempDir(), ".openagents")
	svc := NewSkillService(storage.NewFS(baseDir))

	_, err := svc.Create(context.Background(), model.CreateSkillRequest{
		Name:        "clearable-skill",
		Description: "Original fallback description",
		DescriptionI18n: map[string]string{
			"en-US": "English description",
		},
		SkillMD: "Skill body",
	}, uuid.Nil)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	empty := map[string]string{}
	updated, err := svc.Update(context.Background(), "clearable-skill", model.UpdateSkillRequest{
		DescriptionI18n: &empty,
	})
	if err != nil {
		t.Fatalf("Update() error = %v", err)
	}
	if updated.DescriptionI18n != nil {
		t.Fatalf("updated.DescriptionI18n = %#v, want nil", updated.DescriptionI18n)
	}

	path := filepath.Join(
		baseDir,
		"skills",
		"store",
		"dev",
		"clearable-skill",
		skillfs.DescriptionI18nFileName,
	)
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("expected %s to be removed, stat err = %v", path, err)
	}
}
