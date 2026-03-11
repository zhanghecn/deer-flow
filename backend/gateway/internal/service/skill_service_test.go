package service

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/openagents/gateway/internal/model"
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
