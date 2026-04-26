package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/openagents/gateway/internal/middleware"
	"github.com/openagents/gateway/internal/model"
	"github.com/openagents/gateway/internal/repository"
	"github.com/openagents/gateway/internal/service"
	"github.com/openagents/gateway/pkg/storage"
)

type stubAuthoringThreadRepo struct {
	record   *repository.ThreadRuntimeRecord
	err      error
	ownerID  uuid.UUID
	ownerErr error
}

func (s *stubAuthoringThreadRepo) GetRuntimeByUser(
	_ context.Context,
	_ uuid.UUID,
	_ string,
) (*repository.ThreadRuntimeRecord, error) {
	if s.err != nil {
		return nil, s.err
	}
	if s.record == nil {
		return nil, nil
	}
	return s.record, nil
}

func (s *stubAuthoringThreadRepo) GetOwnerByThreadID(
	_ context.Context,
	_ string,
) (uuid.UUID, error) {
	if s.ownerErr != nil {
		return uuid.Nil, s.ownerErr
	}
	if s.ownerID == uuid.Nil {
		return uuid.Nil, pgx.ErrNoRows
	}
	return s.ownerID, nil
}

func newAuthoringAuthedContext(
	method string,
	target string,
	body string,
	userID uuid.UUID,
) (*gin.Context, *httptest.ResponseRecorder) {
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	request := httptest.NewRequest(method, target, strings.NewReader(body))
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	context.Request = request
	context.Set(string(middleware.UserIDKey), userID)
	context.Set(string(middleware.RoleKey), "user")
	return context, recorder
}

func createAgentDraft(
	t *testing.T,
	handler *AuthoringWorkspaceHandler,
	userID uuid.UUID,
	threadID string,
	agentName string,
	agentStatus string,
) {
	t.Helper()
	context, recorder := newAuthoringAuthedContext(
		http.MethodPost,
		"/api/authoring/agents/"+agentName+"/draft",
		`{"thread_id":"`+threadID+`","agent_status":"`+agentStatus+`"}`,
		userID,
	)
	context.Params = gin.Params{{Key: "name", Value: agentName}}

	handler.CreateAgentDraft(context)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected draft status 200, got %d body=%s", recorder.Code, recorder.Body.String())
	}
}

func readAuthoringAgentsMD(t *testing.T, fsStore *storage.FS, threadID string, agentName string) string {
	t.Helper()
	path := filepath.Join(
		fsStore.ThreadUserDataDir(threadID),
		"authoring",
		"agents",
		"dev",
		agentName,
		"AGENTS.md",
	)
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read authoring AGENTS.md: %v", err)
	}
	return string(data)
}

func TestAuthoringWorkspaceHandlerCreateAgentDraftCopiesArchiveIntoThreadDraft(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	fsStore := storage.NewFS(t.TempDir())
	userID := uuid.New()
	threadID := "thread-authoring"
	seedOwnedAgentArchive(t, fsStore, "reviewer", "dev", userID.String())

	handler := NewAuthoringWorkspaceHandler(
		service.NewAuthoringWorkspaceService(fsStore),
		fsStore,
		&stubAuthoringThreadRepo{
			record: &repository.ThreadRuntimeRecord{ThreadID: threadID},
		},
	)

	context, recorder := newAuthoringAuthedContext(
		http.MethodPost,
		"/api/authoring/agents/reviewer/draft",
		`{"thread_id":"`+threadID+`","agent_status":"dev"}`,
		userID,
	)
	context.Params = gin.Params{{Key: "name", Value: "reviewer"}}

	handler.CreateAgentDraft(context)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", recorder.Code, recorder.Body.String())
	}

	var payload struct {
		RootPath string                     `json:"root_path"`
		Files    []model.AuthoringFileEntry `json:"files"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if payload.RootPath != "/mnt/user-data/authoring/agents/dev/reviewer" {
		t.Fatalf("payload.RootPath = %q, want %q", payload.RootPath, "/mnt/user-data/authoring/agents/dev/reviewer")
	}
	if len(payload.Files) == 0 {
		t.Fatal("expected draft file list to be populated")
	}

	draftAgentsPath := filepath.Join(
		fsStore.ThreadUserDataDir(threadID),
		"authoring",
		"agents",
		"dev",
		"reviewer",
		"AGENTS.md",
	)
	data, err := os.ReadFile(draftAgentsPath)
	if err != nil {
		t.Fatalf("read staged AGENTS.md: %v", err)
	}
	if string(data) != "# Agent" {
		t.Fatalf("draft AGENTS.md = %q, want %q", string(data), "# Agent")
	}
}

func TestAuthoringWorkspaceHandlerCreateAgentDraftRefreshesCleanDraftAfterArchiveChange(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	fsStore := storage.NewFS(t.TempDir())
	userID := uuid.New()
	threadID := "thread-authoring"
	seedOwnedAgentArchive(t, fsStore, "reviewer", "dev", userID.String())

	handler := NewAuthoringWorkspaceHandler(
		service.NewAuthoringWorkspaceService(fsStore),
		fsStore,
		&stubAuthoringThreadRepo{
			record: &repository.ThreadRuntimeRecord{ThreadID: threadID},
		},
	)

	createAgentDraft(t, handler, userID, threadID, "reviewer", "dev")
	time.Sleep(10 * time.Millisecond)
	if err := fsStore.WriteAgentFiles("reviewer", "dev", "# Agent\n\nUpdated source", map[string]interface{}{
		"name":           "reviewer",
		"description":    "Owned agent",
		"status":         "dev",
		"owner_user_id":  userID.String(),
		"agents_md_path": "AGENTS.md",
	}); err != nil {
		t.Fatalf("update agent archive: %v", err)
	}

	createAgentDraft(t, handler, userID, threadID, "reviewer", "dev")

	data := readAuthoringAgentsMD(t, fsStore, threadID, "reviewer")
	if !strings.Contains(data, "Updated source") {
		t.Fatalf("draft AGENTS.md was not refreshed from archive: %s", data)
	}
}

func TestAuthoringWorkspaceHandlerCreateAgentDraftPreservesEditedDraftAfterArchiveChange(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	fsStore := storage.NewFS(t.TempDir())
	userID := uuid.New()
	threadID := "thread-authoring"
	seedOwnedAgentArchive(t, fsStore, "reviewer", "dev", userID.String())

	handler := NewAuthoringWorkspaceHandler(
		service.NewAuthoringWorkspaceService(fsStore),
		fsStore,
		&stubAuthoringThreadRepo{
			record: &repository.ThreadRuntimeRecord{ThreadID: threadID},
		},
	)

	createAgentDraft(t, handler, userID, threadID, "reviewer", "dev")
	writeContext, writeRecorder := newAuthoringAuthedContext(
		http.MethodPut,
		"/api/authoring/file",
		`{"thread_id":"`+threadID+`","path":"/mnt/user-data/authoring/agents/dev/reviewer/AGENTS.md","content":"# Agent\n\nLocal draft edit"}`,
		userID,
	)
	handler.WriteFile(writeContext)
	if writeRecorder.Code != http.StatusOK {
		t.Fatalf("expected write status 200, got %d body=%s", writeRecorder.Code, writeRecorder.Body.String())
	}
	time.Sleep(10 * time.Millisecond)
	if err := fsStore.WriteAgentFiles("reviewer", "dev", "# Agent\n\nUpdated source", map[string]interface{}{
		"name":           "reviewer",
		"description":    "Owned agent",
		"status":         "dev",
		"owner_user_id":  userID.String(),
		"agents_md_path": "AGENTS.md",
	}); err != nil {
		t.Fatalf("update agent archive: %v", err)
	}

	createAgentDraft(t, handler, userID, threadID, "reviewer", "dev")

	data := readAuthoringAgentsMD(t, fsStore, threadID, "reviewer")
	if !strings.Contains(data, "Local draft edit") {
		t.Fatalf("draft AGENTS.md did not preserve local edit: %s", data)
	}
	if strings.Contains(data, "Updated source") {
		t.Fatalf("edited draft was unexpectedly overwritten by archive: %s", data)
	}
}

func TestAuthoringWorkspaceHandlerCreateAgentDraftMigratesLegacyStaleDraft(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	fsStore := storage.NewFS(t.TempDir())
	userID := uuid.New()
	threadID := "thread-authoring"
	seedOwnedAgentArchive(t, fsStore, "reviewer", "dev", userID.String())

	draftDir := filepath.Join(
		fsStore.ThreadUserDataDir(threadID),
		"authoring",
		"agents",
		"dev",
		"reviewer",
	)
	if err := fsStore.CopyDir(fsStore.AgentDir("reviewer", "dev"), draftDir); err != nil {
		t.Fatalf("seed legacy draft: %v", err)
	}
	oldTime := time.Now().Add(-time.Hour)
	for _, name := range []string{"AGENTS.md", "config.yaml"} {
		if err := os.Chtimes(filepath.Join(draftDir, name), oldTime, oldTime); err != nil {
			t.Fatalf("age legacy draft file %s: %v", name, err)
		}
	}
	if err := fsStore.WriteAgentFiles("reviewer", "dev", "# Agent\n\nUpdated source", map[string]interface{}{
		"name":           "reviewer",
		"description":    "Owned agent",
		"status":         "dev",
		"owner_user_id":  userID.String(),
		"agents_md_path": "AGENTS.md",
	}); err != nil {
		t.Fatalf("update agent archive: %v", err)
	}

	handler := NewAuthoringWorkspaceHandler(
		service.NewAuthoringWorkspaceService(fsStore),
		fsStore,
		&stubAuthoringThreadRepo{
			record: &repository.ThreadRuntimeRecord{ThreadID: threadID},
		},
	)

	createAgentDraft(t, handler, userID, threadID, "reviewer", "dev")

	data := readAuthoringAgentsMD(t, fsStore, threadID, "reviewer")
	if !strings.Contains(data, "Updated source") {
		t.Fatalf("legacy stale draft was not migrated to archive content: %s", data)
	}
}

func TestAuthoringWorkspaceHandlerReadAndWriteRejectPathTraversal(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	fsStore := storage.NewFS(t.TempDir())
	threadID := "thread-authoring"
	userID := uuid.New()
	handler := NewAuthoringWorkspaceHandler(
		service.NewAuthoringWorkspaceService(fsStore),
		fsStore,
		&stubAuthoringThreadRepo{
			record: &repository.ThreadRuntimeRecord{ThreadID: threadID},
		},
	)

	writeContext, writeRecorder := newAuthoringAuthedContext(
		http.MethodPut,
		"/api/authoring/file",
		`{"thread_id":"`+threadID+`","path":"/mnt/user-data/authoring/../workspace/escape.txt","content":"blocked"}`,
		userID,
	)
	handler.WriteFile(writeContext)

	if writeRecorder.Code != http.StatusBadRequest {
		t.Fatalf("expected write status 400, got %d body=%s", writeRecorder.Code, writeRecorder.Body.String())
	}

	var writePayload model.ErrorResponse
	if err := json.Unmarshal(writeRecorder.Body.Bytes(), &writePayload); err != nil {
		t.Fatalf("unmarshal write response: %v", err)
	}
	if !strings.Contains(writePayload.Error, "path traversal") {
		t.Fatalf("write error = %q, want path traversal message", writePayload.Error)
	}

	readContext, readRecorder := newAuthoringAuthedContext(
		http.MethodGet,
		"/api/authoring/file?thread_id="+threadID+"&path=/mnt/user-data/authoring/../workspace/escape.txt",
		"",
		userID,
	)
	handler.ReadFile(readContext)

	if readRecorder.Code != http.StatusBadRequest {
		t.Fatalf("expected read status 400, got %d body=%s", readRecorder.Code, readRecorder.Body.String())
	}

	var readPayload model.ErrorResponse
	if err := json.Unmarshal(readRecorder.Body.Bytes(), &readPayload); err != nil {
		t.Fatalf("unmarshal read response: %v", err)
	}
	if !strings.Contains(readPayload.Error, "path traversal") {
		t.Fatalf("read error = %q, want path traversal message", readPayload.Error)
	}
}

func TestAuthoringWorkspaceHandlerSaveSkillDraftPersistsIntoCustomSkills(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	fsStore := storage.NewFS(t.TempDir())
	threadID := "thread-authoring"
	userID := uuid.New()

	legacySkillDir := filepath.Join(fsStore.StoreProdSkillsDir(), "vercel-deploy-claimable")
	if err := os.MkdirAll(legacySkillDir, 0o755); err != nil {
		t.Fatalf("mkdir legacy skill dir: %v", err)
	}
	if err := os.WriteFile(
		filepath.Join(legacySkillDir, "SKILL.md"),
		[]byte("---\nname: vercel-deploy\ndescription: legacy skill\n---\n\nlegacy body"),
		0o644,
	); err != nil {
		t.Fatalf("write legacy skill file: %v", err)
	}

	handler := NewAuthoringWorkspaceHandler(
		service.NewAuthoringWorkspaceService(fsStore),
		fsStore,
		&stubAuthoringThreadRepo{
			record: &repository.ThreadRuntimeRecord{ThreadID: threadID},
		},
	)

	createContext, createRecorder := newAuthoringAuthedContext(
		http.MethodPost,
		"/api/authoring/skills/vercel-deploy/draft",
		`{"thread_id":"`+threadID+`","source_path":"store/prod/vercel-deploy-claimable"}`,
		userID,
	)
	createContext.Params = gin.Params{{Key: "name", Value: "vercel-deploy"}}
	handler.CreateSkillDraft(createContext)

	if createRecorder.Code != http.StatusOK {
		t.Fatalf("expected draft status 200, got %d body=%s", createRecorder.Code, createRecorder.Body.String())
	}

	writeContext, writeRecorder := newAuthoringAuthedContext(
		http.MethodPut,
		"/api/authoring/file",
		`{"thread_id":"`+threadID+`","path":"/mnt/user-data/authoring/skills/vercel-deploy/SKILL.md","content":"---\nname: vercel-deploy\ndescription: edited skill\n---\n\nedited body"}`,
		userID,
	)
	handler.WriteFile(writeContext)

	if writeRecorder.Code != http.StatusOK {
		t.Fatalf("expected write status 200, got %d body=%s", writeRecorder.Code, writeRecorder.Body.String())
	}

	saveContext, saveRecorder := newAuthoringAuthedContext(
		http.MethodPost,
		"/api/authoring/skills/vercel-deploy/save",
		`{"thread_id":"`+threadID+`"}`,
		userID,
	)
	saveContext.Params = gin.Params{{Key: "name", Value: "vercel-deploy"}}
	handler.SaveSkillDraft(saveContext)

	if saveRecorder.Code != http.StatusOK {
		t.Fatalf("expected save status 200, got %d body=%s", saveRecorder.Code, saveRecorder.Body.String())
	}

	savedSkillPath := filepath.Join(fsStore.CustomSkillsDir(), "vercel-deploy", "SKILL.md")
	data, err := os.ReadFile(savedSkillPath)
	if err != nil {
		t.Fatalf("read saved custom skill: %v", err)
	}
	if !strings.Contains(string(data), "description: edited skill") {
		t.Fatalf("saved skill missing edited description: %s", string(data))
	}
	if !strings.Contains(string(data), "edited body") {
		t.Fatalf("saved skill missing edited body: %s", string(data))
	}
}

func TestAuthoringWorkspaceHandlerAllowsUnboundDraftThreadIDs(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	fsStore := storage.NewFS(t.TempDir())
	userID := uuid.New()
	threadID := uuid.NewString()
	seedOwnedAgentArchive(t, fsStore, "reviewer", "dev", userID.String())

	handler := NewAuthoringWorkspaceHandler(
		service.NewAuthoringWorkspaceService(fsStore),
		fsStore,
		&stubAuthoringThreadRepo{
			err:      pgx.ErrNoRows,
			ownerErr: pgx.ErrNoRows,
		},
	)

	context, recorder := newAuthoringAuthedContext(
		http.MethodPost,
		"/api/authoring/agents/reviewer/draft",
		`{"thread_id":"`+threadID+`","agent_status":"dev"}`,
		userID,
	)
	context.Params = gin.Params{{Key: "name", Value: "reviewer"}}

	handler.CreateAgentDraft(context)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", recorder.Code, recorder.Body.String())
	}

	if _, err := os.Stat(fsStore.ThreadUserDataDir(threadID)); err != nil {
		t.Fatalf("expected unbound draft thread dirs to be initialized: %v", err)
	}
}
