package service

import (
	"archive/zip"
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/openagents/gateway/internal/model"
	"github.com/openagents/gateway/internal/skillfs"
	"github.com/openagents/gateway/pkg/storage"
)

func TestSkillServiceCreateEnsuresFrontmatterInCustomSkills(t *testing.T) {
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
	if skill.Category != "custom" {
		t.Fatalf("skill.Category = %q, want %q", skill.Category, "custom")
	}
	if skill.SourcePath != "custom/skills/contract-checker" {
		t.Fatalf("skill.SourcePath = %q, want %q", skill.SourcePath, "custom/skills/contract-checker")
	}
	if !skill.CanEdit {
		t.Fatal("skill.CanEdit = false, want true")
	}

	skillFile := filepath.Join(baseDir, "custom", "skills", "contract-checker", "SKILL.md")
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

	legacyDevDir := filepath.Join(baseDir, "skills", "store", "dev", "risk-score")
	if err := os.MkdirAll(legacyDevDir, 0o755); err != nil {
		t.Fatalf("mkdir legacy skill dir: %v", err)
	}
	if err := os.WriteFile(
		filepath.Join(legacyDevDir, "SKILL.md"),
		[]byte("---\nname: risk-score\ndescription: Rates risk\n---\n\nSkill body"),
		0o644,
	); err != nil {
		t.Fatalf("write legacy skill file: %v", err)
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

	values, err := skillfs.LoadDescriptionI18nFile(filepath.Join(baseDir, "custom", "skills", "bilingual-skill"))
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
		"custom",
		"skills",
		"clearable-skill",
		skillfs.DescriptionI18nFileName,
	)
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("expected %s to be removed, stat err = %v", path, err)
	}
}

func TestSkillServiceCreateRejectsDuplicateVisibleLegacyAliasName(t *testing.T) {
	t.Parallel()

	baseDir := filepath.Join(t.TempDir(), ".openagents")
	legacyProdDir := filepath.Join(baseDir, "skills", "store", "prod", "vercel-deploy-claimable")
	if err := os.MkdirAll(legacyProdDir, 0o755); err != nil {
		t.Fatalf("mkdir legacy skill dir: %v", err)
	}
	if err := os.WriteFile(
		filepath.Join(legacyProdDir, "SKILL.md"),
		[]byte("---\nname: vercel-deploy\ndescription: aliased skill\n---\n\nbody"),
		0o644,
	); err != nil {
		t.Fatalf("write legacy skill file: %v", err)
	}

	svc := NewSkillService(storage.NewFS(baseDir))
	_, err := svc.Create(context.Background(), model.CreateSkillRequest{
		Name:        "vercel-deploy",
		Description: "Custom duplicate",
		SkillMD:     "body",
	}, uuid.Nil)
	if err == nil {
		t.Fatal("expected duplicate visible-name error")
	}
	if !strings.Contains(err.Error(), "store/prod") {
		t.Fatalf("Create() error = %v, want store/prod duplicate mention", err)
	}
}

func TestSkillServiceUpdateRejectsReadOnlyLegacySkill(t *testing.T) {
	t.Parallel()

	baseDir := filepath.Join(t.TempDir(), ".openagents")
	legacyDevDir := filepath.Join(baseDir, "skills", "store", "dev", "risk-score")
	if err := os.MkdirAll(legacyDevDir, 0o755); err != nil {
		t.Fatalf("mkdir legacy skill dir: %v", err)
	}
	if err := os.WriteFile(
		filepath.Join(legacyDevDir, "SKILL.md"),
		[]byte("---\nname: risk-score\ndescription: legacy skill\n---\n\nbody"),
		0o644,
	); err != nil {
		t.Fatalf("write legacy skill file: %v", err)
	}

	svc := NewSkillService(storage.NewFS(baseDir))
	description := "Updated"
	_, err := svc.Update(context.Background(), "risk-score", model.UpdateSkillRequest{
		Description: &description,
	})
	if !errors.Is(err, ErrSkillReadOnly) {
		t.Fatalf("Update() error = %v, want ErrSkillReadOnly", err)
	}
}

func TestSkillServiceGetLoadsAliasedSkillBySourcePath(t *testing.T) {
	t.Parallel()

	baseDir := filepath.Join(t.TempDir(), ".openagents")
	aliasedProdDir := filepath.Join(baseDir, "skills", "store", "prod", "vercel-deploy-claimable")
	if err := os.MkdirAll(aliasedProdDir, 0o755); err != nil {
		t.Fatalf("mkdir aliased skill dir: %v", err)
	}
	if err := os.WriteFile(
		filepath.Join(aliasedProdDir, "SKILL.md"),
		[]byte("---\nname: vercel-deploy\ndescription: aliased skill\n---\n\nbody"),
		0o644,
	); err != nil {
		t.Fatalf("write aliased skill file: %v", err)
	}

	svc := NewSkillService(storage.NewFS(baseDir))
	skill, err := svc.Get(context.Background(), "vercel-deploy", "store/prod/vercel-deploy-claimable")
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if skill.SourcePath != "store/prod/vercel-deploy-claimable" {
		t.Fatalf("skill.SourcePath = %q, want %q", skill.SourcePath, "store/prod/vercel-deploy-claimable")
	}
	if skill.Category != "store/prod" {
		t.Fatalf("skill.Category = %q, want %q", skill.Category, "store/prod")
	}
	if skill.CanEdit {
		t.Fatal("skill.CanEdit = true, want false")
	}
}

func TestSkillServiceExportPackagesSkillDirectory(t *testing.T) {
	t.Parallel()

	baseDir := filepath.Join(t.TempDir(), ".openagents")
	skillDir := filepath.Join(baseDir, "custom", "skills", "sdk-helper")
	if err := os.MkdirAll(filepath.Join(skillDir, "references"), 0o755); err != nil {
		t.Fatalf("mkdir references: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(skillDir, "scripts"), 0o755); err != nil {
		t.Fatalf("mkdir scripts: %v", err)
	}
	if err := os.WriteFile(
		filepath.Join(skillDir, "SKILL.md"),
		[]byte("---\nname: sdk-helper\ndescription: Helps integrate SDKs\n---\n\nbody"),
		0o644,
	); err != nil {
		t.Fatalf("write SKILL.md: %v", err)
	}
	if err := os.WriteFile(
		filepath.Join(skillDir, "references", "contract.md"),
		[]byte("contract"),
		0o644,
	); err != nil {
		t.Fatalf("write contract.md: %v", err)
	}
	if err := os.WriteFile(
		filepath.Join(skillDir, "scripts", "check.sh"),
		[]byte("#!/bin/sh\necho ok\n"),
		0o755,
	); err != nil {
		t.Fatalf("write check.sh: %v", err)
	}

	svc := NewSkillService(storage.NewFS(baseDir))
	filename, archive, err := svc.Export(context.Background(), "sdk-helper", "custom/skills/sdk-helper")
	if err != nil {
		t.Fatalf("Export() error = %v", err)
	}
	if filename != "sdk-helper.skill" {
		t.Fatalf("filename = %q, want %q", filename, "sdk-helper.skill")
	}

	reader, err := zip.NewReader(bytes.NewReader(archive), int64(len(archive)))
	if err != nil {
		t.Fatalf("zip.NewReader() error = %v", err)
	}

	entries := make(map[string]struct{}, len(reader.File))
	for _, file := range reader.File {
		entries[file.Name] = struct{}{}
	}
	for _, expected := range []string{
		"sdk-helper/SKILL.md",
		"sdk-helper/references/contract.md",
		"sdk-helper/scripts/check.sh",
	} {
		if _, ok := entries[expected]; !ok {
			t.Fatalf("archive missing %q; entries=%v", expected, entries)
		}
	}
}
