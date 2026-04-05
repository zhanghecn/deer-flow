package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/openagents/gateway/internal/middleware"
	"github.com/openagents/gateway/internal/model"
	"github.com/openagents/gateway/internal/service"
	"github.com/openagents/gateway/pkg/storage"
)

func seedOwnedAgentArchive(t *testing.T, fsStore *storage.FS, name string, status string, ownerUserID string) {
	t.Helper()

	if err := fsStore.WriteAgentFiles(name, status, "# Agent", map[string]interface{}{
		"name":           name,
		"description":    "Owned agent",
		"status":         status,
		"owner_user_id":  ownerUserID,
		"agents_md_path": "AGENTS.md",
	}); err != nil {
		t.Fatalf("seed agent files: %v", err)
	}
}

func newAuthedAgentContext(method string, target string, userID uuid.UUID, role string) (*gin.Context, *httptest.ResponseRecorder) {
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(method, target, nil)
	context.Set(string(middleware.UserIDKey), userID)
	context.Set(string(middleware.RoleKey), role)
	return context, recorder
}

func TestAgentHandlerGetAllowsUsageButMarksNonOwnerAsReadOnly(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	fsStore := storage.NewFS(t.TempDir())
	ownerUserID := uuid.New()
	viewerUserID := uuid.New()
	seedOwnedAgentArchive(t, fsStore, "reviewer", "dev", ownerUserID.String())

	handler := NewAgentHandler(service.NewAgentService(fsStore), fsStore, nil, nil)
	context, recorder := newAuthedAgentContext(http.MethodGet, "/api/agents/reviewer?status=dev", viewerUserID, "user")
	context.Params = gin.Params{{Key: "name", Value: "reviewer"}}

	handler.Get(context)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", recorder.Code, recorder.Body.String())
	}

	var payload model.Agent
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if payload.OwnerUserID != ownerUserID.String() {
		t.Fatalf("payload.OwnerUserID = %q, want %q", payload.OwnerUserID, ownerUserID.String())
	}
	if payload.CanManage {
		t.Fatalf("payload.CanManage = true, want false for non-owner")
	}
}

func TestAgentHandlerListAnnotatesReadOnlyAgentsForNonOwners(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	fsStore := storage.NewFS(t.TempDir())
	ownerUserID := uuid.New()
	viewerUserID := uuid.New()
	seedOwnedAgentArchive(t, fsStore, "reviewer", "dev", ownerUserID.String())

	handler := NewAgentHandler(service.NewAgentService(fsStore), fsStore, nil, nil)
	context, recorder := newAuthedAgentContext(http.MethodGet, "/api/agents?status=dev", viewerUserID, "user")

	handler.List(context)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", recorder.Code, recorder.Body.String())
	}

	var payload struct {
		Agents []model.Agent `json:"agents"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if len(payload.Agents) != 1 {
		t.Fatalf("len(payload.Agents) = %d, want 1", len(payload.Agents))
	}
	if payload.Agents[0].CanManage {
		t.Fatalf("payload.Agents[0].CanManage = true, want false for non-owner")
	}
}

func TestAgentHandlerPublishRejectsNonOwner(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	fsStore := storage.NewFS(t.TempDir())
	ownerUserID := uuid.New()
	viewerUserID := uuid.New()
	seedOwnedAgentArchive(t, fsStore, "reviewer", "dev", ownerUserID.String())

	handler := NewAgentHandler(service.NewAgentService(fsStore), fsStore, nil, nil)
	context, recorder := newAuthedAgentContext(http.MethodPost, "/api/agents/reviewer/publish", viewerUserID, "user")
	context.Params = gin.Params{{Key: "name", Value: "reviewer"}}

	handler.Publish(context)

	if recorder.Code != http.StatusForbidden {
		t.Fatalf("expected status 403, got %d body=%s", recorder.Code, recorder.Body.String())
	}

	var payload model.ErrorResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if payload.Details != manageAgentForbiddenDetail {
		t.Fatalf("payload.Details = %q, want %q", payload.Details, manageAgentForbiddenDetail)
	}
}

func TestAgentHandlerClaimAssignsOwnerForLegacyOwnerlessAgent(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	fsStore := storage.NewFS(t.TempDir())
	claimerUserID := uuid.New()
	if err := fsStore.WriteAgentFiles("reviewer", "dev", "# Agent", map[string]interface{}{
		"name":           "reviewer",
		"description":    "Legacy ownerless agent",
		"status":         "dev",
		"agents_md_path": "AGENTS.md",
	}); err != nil {
		t.Fatalf("seed agent files: %v", err)
	}

	handler := NewAgentHandler(service.NewAgentService(fsStore), fsStore, nil, nil)
	context, recorder := newAuthedAgentContext(http.MethodPost, "/api/agents/reviewer/claim?status=dev", claimerUserID, "user")
	context.Params = gin.Params{{Key: "name", Value: "reviewer"}}

	handler.Claim(context)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", recorder.Code, recorder.Body.String())
	}

	var payload model.Agent
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if payload.OwnerUserID != claimerUserID.String() {
		t.Fatalf("payload.OwnerUserID = %q, want %q", payload.OwnerUserID, claimerUserID.String())
	}
	if !payload.CanManage {
		t.Fatal("payload.CanManage = false, want true for claimer")
	}
}
