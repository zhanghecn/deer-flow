package handler

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
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

func marshalPortableAgentPackage(t *testing.T, status string) []byte {
	t.Helper()

	config := "name: portable\nstatus: " + status + "\ndescription: Portable\nagents_md_path: AGENTS.md\n"
	pkg := model.AgentPackage{
		SchemaVersion: 1,
		Kind:          "openagents.agent.package",
		Agent: model.Agent{
			Name:   "portable",
			Status: status,
		},
		Files: []model.AgentPackageFile{
			{
				Path:          "config.yaml",
				ContentBase64: base64.StdEncoding.EncodeToString([]byte(config)),
				SizeBytes:     int64(len(config)),
			},
			{
				Path:          "AGENTS.md",
				ContentBase64: base64.StdEncoding.EncodeToString([]byte("# Portable")),
				SizeBytes:     int64(len("# Portable")),
			},
		},
	}
	body, err := json.Marshal(pkg)
	if err != nil {
		t.Fatalf("marshal package: %v", err)
	}
	return body
}

func TestAgentHandlerGetAllowsUsageButMarksNonOwnerAsReadOnly(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	fsStore := storage.NewFS(t.TempDir())
	ownerUserID := uuid.New()
	viewerUserID := uuid.New()
	seedOwnedAgentArchive(t, fsStore, "reviewer", "dev", ownerUserID.String())

	handler := NewAgentHandler(service.NewAgentService(fsStore), fsStore, nil)
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

	handler := NewAgentHandler(service.NewAgentService(fsStore), fsStore, nil)
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

	handler := NewAgentHandler(service.NewAgentService(fsStore), fsStore, nil)
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

func TestAgentHandlerExportPackageRejectsNonOwner(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	fsStore := storage.NewFS(t.TempDir())
	ownerUserID := uuid.New()
	viewerUserID := uuid.New()
	seedOwnedAgentArchive(t, fsStore, "reviewer", "dev", ownerUserID.String())

	handler := NewAgentHandler(service.NewAgentService(fsStore), fsStore, nil)
	context, recorder := newAuthedAgentContext(http.MethodGet, "/api/agents/reviewer/package?status=dev", viewerUserID, "user")
	context.Params = gin.Params{{Key: "name", Value: "reviewer"}}

	handler.ExportPackage(context)

	if recorder.Code != http.StatusForbidden {
		t.Fatalf("expected status 403, got %d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestAgentHandlerImportPackageCreatesUserOwnedDraft(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	fsStore := storage.NewFS(t.TempDir())
	userID := uuid.New()
	body := marshalPortableAgentPackage(t, "prod")

	handler := NewAgentHandler(service.NewAgentService(fsStore), fsStore, nil)
	context, recorder := newAuthedAgentContext(http.MethodPost, "/api/agents/import?status=prod", userID, "user")
	context.Request = httptest.NewRequest(http.MethodPost, "/api/agents/import?status=prod", bytes.NewReader(body))
	context.Request.Header.Set("Content-Type", "application/json")

	handler.ImportPackage(context)

	if recorder.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d body=%s", recorder.Code, recorder.Body.String())
	}

	var payload model.Agent
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if payload.Status != "dev" {
		t.Fatalf("payload.Status = %q, want dev", payload.Status)
	}
	if payload.OwnerUserID != userID.String() {
		t.Fatalf("payload.OwnerUserID = %q, want %q", payload.OwnerUserID, userID.String())
	}
	if _, err := os.Stat(filepath.Join(fsStore.AgentDir("portable", "dev"), "config.yaml")); err != nil {
		t.Fatalf("expected dev import archive: %v", err)
	}
	if _, err := os.Stat(fsStore.AgentDir("portable", "prod")); !os.IsNotExist(err) {
		t.Fatalf("expected no prod import archive, stat err = %v", err)
	}
}

func TestAgentHandlerAdminImportPackagePreservesArchiveStatus(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	fsStore := storage.NewFS(t.TempDir())
	adminID := uuid.New()
	body := marshalPortableAgentPackage(t, "prod")

	handler := NewAgentHandler(service.NewAgentService(fsStore), fsStore, nil)
	context, recorder := newAuthedAgentContext(http.MethodPost, "/api/admin/agents/import", adminID, "admin")
	context.Request = httptest.NewRequest(http.MethodPost, "/api/admin/agents/import", bytes.NewReader(body))
	context.Request.Header.Set("Content-Type", "application/json")

	handler.ImportPackageAdmin(context)

	if recorder.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d body=%s", recorder.Code, recorder.Body.String())
	}

	var payload model.Agent
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if payload.Status != "prod" {
		t.Fatalf("payload.Status = %q, want prod", payload.Status)
	}
	if payload.OwnerUserID != adminID.String() {
		t.Fatalf("payload.OwnerUserID = %q, want %q", payload.OwnerUserID, adminID.String())
	}
	if _, err := os.Stat(filepath.Join(fsStore.AgentDir("portable", "prod"), "config.yaml")); err != nil {
		t.Fatalf("expected prod import archive: %v", err)
	}
}

func TestAgentHandlerGetMarksLegacyOwnerlessAgentReadOnly(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	fsStore := storage.NewFS(t.TempDir())
	viewerUserID := uuid.New()
	if err := fsStore.WriteAgentFiles("reviewer", "dev", "# Agent", map[string]interface{}{
		"name":           "reviewer",
		"description":    "Legacy ownerless agent",
		"status":         "dev",
		"agents_md_path": "AGENTS.md",
	}); err != nil {
		t.Fatalf("seed agent files: %v", err)
	}

	handler := NewAgentHandler(service.NewAgentService(fsStore), fsStore, nil)
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
	if payload.OwnerUserID != "" {
		t.Fatalf("payload.OwnerUserID = %q, want empty owner for legacy archive", payload.OwnerUserID)
	}
	if payload.CanManage {
		t.Fatal("payload.CanManage = true, want false for ownerless legacy archive")
	}
}

func TestResolvePublicGatewayBaseURLPreservesForwardedHostPort(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	context, _ := gin.CreateTestContext(httptest.NewRecorder())
	context.Request = httptest.NewRequest(http.MethodGet, "/api/agents/reviewer/export", nil)
	context.Request.Host = "127.0.0.1"
	context.Request.Header.Set("X-Forwarded-Proto", "http")
	context.Request.Header.Set("X-Forwarded-Host", "127.0.0.1:8083")

	if got := resolvePublicGatewayBaseURL(context); got != "http://127.0.0.1:8083" {
		t.Fatalf("resolvePublicGatewayBaseURL() = %q, want %q", got, "http://127.0.0.1:8083")
	}
}

func TestResolvePublicGatewayBaseURLUsesForwardedPortWhenProxyDropsItFromHost(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	context, _ := gin.CreateTestContext(httptest.NewRecorder())
	context.Request = httptest.NewRequest(http.MethodGet, "/api/agents/reviewer/export", nil)
	context.Request.Host = "127.0.0.1"
	context.Request.Header.Set("X-Forwarded-Proto", "http")
	context.Request.Header.Set("X-Forwarded-Host", "127.0.0.1")
	context.Request.Header.Set("X-Forwarded-Port", "8083")

	if got := resolvePublicGatewayBaseURL(context); got != "http://127.0.0.1:8083" {
		t.Fatalf("resolvePublicGatewayBaseURL() = %q, want %q", got, "http://127.0.0.1:8083")
	}
}

func TestBuildExportDocumentUsesPublicDocsAndV1BaseURL(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	context, _ := gin.CreateTestContext(httptest.NewRecorder())
	context.Request = httptest.NewRequest(http.MethodGet, "/open/agents/reviewer/export", nil)
	context.Request.Host = "127.0.0.1"
	context.Request.Header.Set("X-Forwarded-Proto", "http")
	context.Request.Header.Set("X-Forwarded-Host", "127.0.0.1:8083")

	handler := NewAgentHandler(nil, nil, nil)
	doc := handler.buildExportDocument(context, "reviewer")

	if got := doc["gateway_base_url"]; got != "http://127.0.0.1:8083" {
		t.Fatalf("gateway_base_url = %v, want %q", got, "http://127.0.0.1:8083")
	}
	if got := doc["api_base_url"]; got != "http://127.0.0.1:8083/v1" {
		t.Fatalf("api_base_url = %v, want %q", got, "http://127.0.0.1:8083/v1")
	}
	if got := doc["documentation_url"]; got != "http://127.0.0.1:8083/docs/agents/reviewer" {
		t.Fatalf("documentation_url = %v, want %q", got, "http://127.0.0.1:8083/docs/agents/reviewer")
	}
	if got := doc["reference_url"]; got != "http://127.0.0.1:8083/docs/agents/reviewer/reference" {
		t.Fatalf("reference_url = %v, want %q", got, "http://127.0.0.1:8083/docs/agents/reviewer/reference")
	}
	if got := doc["playground_url"]; got != "http://127.0.0.1:8083/docs/agents/reviewer/playground" {
		t.Fatalf("playground_url = %v, want %q", got, "http://127.0.0.1:8083/docs/agents/reviewer/playground")
	}
	if got := doc["openapi_url"]; got != "http://127.0.0.1:8083/open/agents/reviewer/openapi.json" {
		t.Fatalf("openapi_url = %v, want %q", got, "http://127.0.0.1:8083/open/agents/reviewer/openapi.json")
	}
	if got := doc["documentation_json_url"]; got != "http://127.0.0.1:8083/open/agents/reviewer/export" {
		t.Fatalf("documentation_json_url = %v, want %q", got, "http://127.0.0.1:8083/open/agents/reviewer/export")
	}
}

func TestBuildOpenAPIDocumentUsesPublishedV1ServerAndExamples(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	context, _ := gin.CreateTestContext(httptest.NewRecorder())
	context.Request = httptest.NewRequest(http.MethodGet, "/open/agents/reviewer/openapi.json", nil)
	context.Request.Host = "127.0.0.1"
	context.Request.Header.Set("X-Forwarded-Proto", "http")
	context.Request.Header.Set("X-Forwarded-Host", "127.0.0.1:8083")

	handler := NewAgentHandler(nil, nil, nil)
	doc := handler.buildOpenAPIDocument(context, "reviewer")

	if got := doc["openapi"]; got != "3.1.0" {
		t.Fatalf("openapi = %v, want %q", got, "3.1.0")
	}

	servers, ok := doc["servers"].([]gin.H)
	if !ok || len(servers) != 1 {
		t.Fatalf("servers = %#v, want one server entry", doc["servers"])
	}
	if got := servers[0]["url"]; got != "http://127.0.0.1:8083/v1" {
		t.Fatalf("servers[0].url = %v, want %q", got, "http://127.0.0.1:8083/v1")
	}

	paths, ok := doc["paths"].(gin.H)
	if !ok {
		t.Fatalf("paths = %#v, want gin.H", doc["paths"])
	}
	responsesPath, ok := paths["/responses"].(gin.H)
	if !ok {
		t.Fatalf("paths[/responses] = %#v, want gin.H", paths["/responses"])
	}
	postOperation, ok := responsesPath["post"].(gin.H)
	if !ok {
		t.Fatalf("paths[/responses][post] = %#v, want gin.H", responsesPath["post"])
	}
	requestBody, ok := postOperation["requestBody"].(gin.H)
	if !ok {
		t.Fatalf("requestBody = %#v, want gin.H", postOperation["requestBody"])
	}
	content, ok := requestBody["content"].(gin.H)
	if !ok {
		t.Fatalf("requestBody.content = %#v, want gin.H", requestBody["content"])
	}
	applicationJSON, ok := content["application/json"].(gin.H)
	if !ok {
		t.Fatalf("requestBody.content[application/json] = %#v, want gin.H", content["application/json"])
	}
	examples, ok := applicationJSON["examples"].(gin.H)
	if !ok {
		t.Fatalf("examples = %#v, want gin.H", applicationJSON["examples"])
	}
	blocking, ok := examples["blocking"].(gin.H)
	if !ok {
		t.Fatalf("examples[blocking] = %#v, want gin.H", examples["blocking"])
	}
	value, ok := blocking["value"].(gin.H)
	if !ok {
		t.Fatalf("examples[blocking].value = %#v, want gin.H", blocking["value"])
	}
	if got := value["model"]; got != "reviewer" {
		t.Fatalf("examples[blocking].value.model = %v, want %q", got, "reviewer")
	}
}
