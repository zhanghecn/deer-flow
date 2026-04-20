package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/openagents/gateway/internal/middleware"
	"github.com/openagents/gateway/internal/model"
	"github.com/openagents/gateway/internal/repository"
	"github.com/openagents/gateway/internal/service"
	"github.com/openagents/gateway/pkg/storage"
)

type stubDesignBoardRepo struct {
	record   *repository.ThreadRuntimeRecord
	err      error
	ownerID  uuid.UUID
	ownerErr error
}

func (s *stubDesignBoardRepo) GetRuntimeByUser(
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

func (s *stubDesignBoardRepo) GetOwnerByThreadID(
	_ context.Context,
	_ string,
) (uuid.UUID, error) {
	if s.ownerErr != nil {
		return uuid.Nil, s.ownerErr
	}
	return s.ownerID, nil
}

func newDesignAuthedContext(
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

func mustParseRelativeDesignURL(t *testing.T, raw string) url.Values {
	t.Helper()

	parsed, err := url.Parse(raw)
	if err != nil {
		t.Fatalf("parse relative url %q: %v", raw, err)
	}
	return parsed.Query()
}

func TestDesignBoardOpenCreatesDefaultThreadDocument(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	fsStore := storage.NewFS(t.TempDir())
	userID := uuid.New()
	threadID := "thread-design"

	handler := NewDesignBoardHandler(
		&stubDesignBoardRepo{record: &repository.ThreadRuntimeRecord{ThreadID: threadID}},
		service.NewDesignBoardService(fsStore),
		"design-secret",
		"",
	)

	context, recorder := newDesignAuthedContext(
		http.MethodPost,
		"/api/threads/"+threadID+"/design-board/open",
		"",
		userID,
	)
	context.Params = gin.Params{{Key: "id", Value: threadID}}

	handler.Open(context)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", recorder.Code, recorder.Body.String())
	}

	var payload struct {
		AccessToken       string `json:"access_token"`
		ThreadID          string `json:"thread_id"`
		SessionID         string `json:"session_id"`
		SessionGeneration int64  `json:"session_generation"`
		TargetPath        string `json:"target_path"`
		Revision          string `json:"revision"`
		RelativeURL       string `json:"relative_url"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if strings.TrimSpace(payload.AccessToken) == "" {
		t.Fatal("expected access token in response")
	}
	if payload.ThreadID != threadID {
		t.Fatalf("thread id = %q, want %q", payload.ThreadID, threadID)
	}
	if strings.TrimSpace(payload.SessionID) == "" {
		t.Fatal("expected session id in response")
	}
	if payload.SessionGeneration <= 0 {
		t.Fatalf("session generation = %d, want > 0", payload.SessionGeneration)
	}
	if payload.TargetPath != service.DefaultDesignDocumentVirtualPath() {
		t.Fatalf("target path = %q, want %q", payload.TargetPath, service.DefaultDesignDocumentVirtualPath())
	}
	if strings.TrimSpace(payload.Revision) == "" {
		t.Fatal("expected revision in response")
	}
	if !strings.Contains(payload.RelativeURL, "/openpencil/editor?") {
		t.Fatalf("relative_url = %q, want /openpencil/editor query url", payload.RelativeURL)
	}
	query := mustParseRelativeDesignURL(t, payload.RelativeURL)
	if query.Get("design_token") != payload.AccessToken {
		t.Fatalf("design_token = %q, want response access token", query.Get("design_token"))
	}
	if query.Get("design_thread_id") != payload.ThreadID {
		t.Fatalf("design_thread_id = %q, want %q", query.Get("design_thread_id"), payload.ThreadID)
	}
	if query.Get("design_session_id") != payload.SessionID {
		t.Fatalf("design_session_id = %q, want %q", query.Get("design_session_id"), payload.SessionID)
	}
	if query.Get("design_session_generation") != strconv.FormatInt(payload.SessionGeneration, 10) {
		t.Fatalf(
			"design_session_generation = %q, want %d",
			query.Get("design_session_generation"),
			payload.SessionGeneration,
		)
	}
	if query.Get("design_target_path") != payload.TargetPath {
		t.Fatalf("design_target_path = %q, want %q", query.Get("design_target_path"), payload.TargetPath)
	}
	if query.Get("design_revision") != payload.Revision {
		t.Fatalf("design_revision = %q, want %q", query.Get("design_revision"), payload.Revision)
	}

	documentPath := filepath.Join(
		fsStore.ThreadUserDataDir(threadID),
		"outputs",
		"designs",
		"canvas.op",
	)
	data, err := os.ReadFile(documentPath)
	if err != nil {
		t.Fatalf("read staged design document: %v", err)
	}
	if !strings.Contains(string(data), "\"version\": \"1.0.0\"") || !strings.Contains(string(data), "\"children\": []") {
		t.Fatalf("default document = %q", string(data))
	}
}

func TestDesignBoardDocumentRoundTripAndRevisionConflict(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	fsStore := storage.NewFS(t.TempDir())
	userID := uuid.New()
	threadID := "thread-design"
	handler := NewDesignBoardHandler(
		&stubDesignBoardRepo{record: &repository.ThreadRuntimeRecord{ThreadID: threadID}},
		service.NewDesignBoardService(fsStore),
		"design-secret",
		"",
	)

	openContext, openRecorder := newDesignAuthedContext(
		http.MethodPost,
		"/api/threads/"+threadID+"/design-board/open",
		"",
		userID,
	)
	openContext.Params = gin.Params{{Key: "id", Value: threadID}}
	handler.Open(openContext)
	if openRecorder.Code != http.StatusOK {
		t.Fatalf("open status = %d body=%s", openRecorder.Code, openRecorder.Body.String())
	}

	var session struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.Unmarshal(openRecorder.Body.Bytes(), &session); err != nil {
		t.Fatalf("unmarshal session: %v", err)
	}

	router := gin.New()
	router.GET("/api/design/document", handler.ReadDocument)
	router.PUT("/api/design/document", handler.WriteDocument)

	readRequest := httptest.NewRequest(http.MethodGet, "/api/design/document", nil)
	readRequest.Header.Set("Authorization", "Bearer "+session.AccessToken)
	readRecorder := httptest.NewRecorder()
	router.ServeHTTP(readRecorder, readRequest)
	if readRecorder.Code != http.StatusOK {
		t.Fatalf("read status = %d body=%s", readRecorder.Code, readRecorder.Body.String())
	}

	var readPayload struct {
		Revision string          `json:"revision"`
		Document json.RawMessage `json:"document"`
	}
	if err := json.Unmarshal(readRecorder.Body.Bytes(), &readPayload); err != nil {
		t.Fatalf("unmarshal read payload: %v", err)
	}
	if strings.TrimSpace(readPayload.Revision) == "" {
		t.Fatal("expected revision in read payload")
	}

	writeBody := []byte(`{"revision":"` + readPayload.Revision + `","document":{"version":"1.0.0","children":[{"id":"hero","type":"frame","name":"Hero","width":1200,"height":600}]}}`)
	writeRequest := httptest.NewRequest(http.MethodPut, "/api/design/document", bytes.NewReader(writeBody))
	writeRequest.Header.Set("Authorization", "Bearer "+session.AccessToken)
	writeRequest.Header.Set("Content-Type", "application/json")
	writeRecorder := httptest.NewRecorder()
	router.ServeHTTP(writeRecorder, writeRequest)
	if writeRecorder.Code != http.StatusOK {
		t.Fatalf("write status = %d body=%s", writeRecorder.Code, writeRecorder.Body.String())
	}

	var writePayload struct {
		Revision string `json:"revision"`
	}
	if err := json.Unmarshal(writeRecorder.Body.Bytes(), &writePayload); err != nil {
		t.Fatalf("unmarshal write payload: %v", err)
	}
	if writePayload.Revision == readPayload.Revision {
		t.Fatalf("expected new revision after write, got same %q", writePayload.Revision)
	}

	documentPath := filepath.Join(
		fsStore.ThreadUserDataDir(threadID),
		"outputs",
		"designs",
		"canvas.op",
	)
	normalizedDocument, err := os.ReadFile(documentPath)
	if err != nil {
		t.Fatalf("read normalized design document: %v", err)
	}
	if !strings.Contains(string(normalizedDocument), "\n  \"children\": [\n") {
		t.Fatalf("expected multiline document formatting, got %q", string(normalizedDocument))
	}

	conflictBody := []byte(`{"revision":"` + readPayload.Revision + `","document":{"version":"1.0.0","children":[]}}`)
	conflictRequest := httptest.NewRequest(http.MethodPut, "/api/design/document", bytes.NewReader(conflictBody))
	conflictRequest.Header.Set("Authorization", "Bearer "+session.AccessToken)
	conflictRequest.Header.Set("Content-Type", "application/json")
	conflictRecorder := httptest.NewRecorder()
	router.ServeHTTP(conflictRecorder, conflictRequest)
	if conflictRecorder.Code != http.StatusConflict {
		t.Fatalf("conflict status = %d body=%s", conflictRecorder.Code, conflictRecorder.Body.String())
	}
}

func TestDesignBoardOpenUsesThreadOwnerForAdminInspection(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	fsStore := storage.NewFS(t.TempDir())
	adminID := uuid.New()
	ownerID := uuid.New()
	threadID := "thread-design-admin"

	handler := NewDesignBoardHandler(
		&stubDesignBoardRepo{
			record:  &repository.ThreadRuntimeRecord{ThreadID: threadID},
			ownerID: ownerID,
		},
		service.NewDesignBoardService(fsStore),
		"design-secret",
		"",
	)

	context, recorder := newDesignAuthedContext(
		http.MethodPost,
		"/api/threads/"+threadID+"/design-board/open",
		"",
		adminID,
	)
	context.Params = gin.Params{{Key: "id", Value: threadID}}
	context.Set(string(middleware.RoleKey), "admin")

	handler.Open(context)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", recorder.Code, recorder.Body.String())
	}

	var payload struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}

	claims, err := handler.parseSessionToken(payload.AccessToken)
	if err != nil {
		t.Fatalf("parse session token: %v", err)
	}
	if claims.UserID != ownerID.String() {
		t.Fatalf("session token user id = %q, want %q", claims.UserID, ownerID.String())
	}
}

func TestDesignBoardReadDocumentNormalizesCommonShorthand(t *testing.T) {
	t.Parallel()

	fsStore := storage.NewFS(t.TempDir())
	threadID := "thread-design"
	documentPath := filepath.Join(
		fsStore.ThreadUserDataDir(threadID),
		"outputs",
		"designs",
		"canvas.op",
	)
	if err := os.MkdirAll(filepath.Dir(documentPath), 0o755); err != nil {
		t.Fatalf("mkdir design dir: %v", err)
	}

	rawDocument := `{"version":"1.0.0","children":[{"id":"page-root","type":"frame","justifyContent":"space-between","padding":{"left":16,"right":16},"children":[{"id":"logo","type":"ellipse","width":64,"height":64,"fill":{"color":"#4F46E5"},"stroke":{"color":"#E5E7EB","width":1},"effects":[{"type":"shadow","blur":12,"color":"#00000010"}]}]}]}`
	if err := os.WriteFile(documentPath, []byte(rawDocument), 0o644); err != nil {
		t.Fatalf("write shorthand document: %v", err)
	}

	designService := service.NewDesignBoardService(fsStore)
	document, _, _, err := designService.ReadDocument(threadID, service.DefaultDesignDocumentVirtualPath())
	if err != nil {
		t.Fatalf("read normalized document: %v", err)
	}

	var parsed map[string]any
	if err := json.Unmarshal(document, &parsed); err != nil {
		t.Fatalf("unmarshal normalized document: %v", err)
	}

	children := parsed["children"].([]any)
	root := children[0].(map[string]any)
	logo := root["children"].([]any)[0].(map[string]any)
	stroke := logo["stroke"].(map[string]any)

	if root["justifyContent"] != "space_between" {
		t.Fatalf("justifyContent = %#v", root["justifyContent"])
	}
	if !reflect.DeepEqual(root["padding"], []any{float64(0), float64(16)}) {
		t.Fatalf("padding = %#v", root["padding"])
	}
	if !reflect.DeepEqual(logo["fill"], []any{map[string]any{"type": "solid", "color": "#4F46E5"}}) {
		t.Fatalf("fill = %#v", logo["fill"])
	}
	if stroke["thickness"] != float64(1) {
		t.Fatalf("stroke thickness = %#v", stroke["thickness"])
	}
	if !reflect.DeepEqual(stroke["fill"], []any{map[string]any{"type": "solid", "color": "#E5E7EB"}}) {
		t.Fatalf("stroke fill = %#v", stroke["fill"])
	}

	normalizedOnDisk, err := os.ReadFile(documentPath)
	if err != nil {
		t.Fatalf("read rewritten document: %v", err)
	}
	if bytes.Equal(normalizedOnDisk, []byte(rawDocument)) {
		t.Fatal("expected shorthand document to be rewritten on read")
	}
	if !strings.Contains(string(normalizedOnDisk), "\"space_between\"") {
		t.Fatalf("normalized document missing canonical justifyContent: %s", string(normalizedOnDisk))
	}
}

func TestDesignBoardOpenRejectsInvalidTargetPath(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	fsStore := storage.NewFS(t.TempDir())
	userID := uuid.New()
	threadID := "thread-design"
	handler := NewDesignBoardHandler(
		&stubDesignBoardRepo{record: &repository.ThreadRuntimeRecord{ThreadID: threadID}},
		service.NewDesignBoardService(fsStore),
		"design-secret",
		"",
	)

	context, recorder := newDesignAuthedContext(
		http.MethodPost,
		"/api/threads/"+threadID+"/design-board/open?target_path=/mnt/user-data/outputs/../workspace/escape.op",
		"",
		userID,
	)
	context.Params = gin.Params{{Key: "id", Value: threadID}}

	handler.Open(context)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d body=%s", recorder.Code, recorder.Body.String())
	}

	var payload model.ErrorResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("unmarshal error response: %v", err)
	}
	if !strings.Contains(payload.Error, "path") {
		t.Fatalf("expected path error, got %q", payload.Error)
	}
}

func TestDesignBoardOpenAcceptsExplicitOutputDesignTarget(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	fsStore := storage.NewFS(t.TempDir())
	userID := uuid.New()
	threadID := "thread-design"
	handler := NewDesignBoardHandler(
		&stubDesignBoardRepo{record: &repository.ThreadRuntimeRecord{ThreadID: threadID}},
		service.NewDesignBoardService(fsStore),
		"design-secret",
		"",
	)

	targetPath := "/mnt/user-data/outputs/designs/landing-v2.op"
	context, recorder := newDesignAuthedContext(
		http.MethodPost,
		"/api/threads/"+threadID+"/design-board/open?target_path="+targetPath,
		"",
		userID,
	)
	context.Params = gin.Params{{Key: "id", Value: threadID}}

	handler.Open(context)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", recorder.Code, recorder.Body.String())
	}

	var payload struct {
		ThreadID          string `json:"thread_id"`
		SessionID         string `json:"session_id"`
		SessionGeneration int64  `json:"session_generation"`
		TargetPath        string `json:"target_path"`
		Revision          string `json:"revision"`
		RelativeURL       string `json:"relative_url"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if payload.ThreadID != threadID {
		t.Fatalf("thread id = %q, want %q", payload.ThreadID, threadID)
	}
	if strings.TrimSpace(payload.SessionID) == "" {
		t.Fatal("expected session id in response")
	}
	if payload.SessionGeneration <= 0 {
		t.Fatalf("session generation = %d, want > 0", payload.SessionGeneration)
	}
	if payload.TargetPath != targetPath {
		t.Fatalf("target path = %q, want %q", payload.TargetPath, targetPath)
	}
	if strings.TrimSpace(payload.Revision) == "" {
		t.Fatal("expected revision in response")
	}
	query := mustParseRelativeDesignURL(t, payload.RelativeURL)
	if query.Get("design_thread_id") != threadID {
		t.Fatalf("design_thread_id = %q, want %q", query.Get("design_thread_id"), threadID)
	}
	if query.Get("design_session_id") != payload.SessionID {
		t.Fatalf("design_session_id = %q, want %q", query.Get("design_session_id"), payload.SessionID)
	}
	if query.Get("design_session_generation") != strconv.FormatInt(payload.SessionGeneration, 10) {
		t.Fatalf(
			"design_session_generation = %q, want %d",
			query.Get("design_session_generation"),
			payload.SessionGeneration,
		)
	}
	if query.Get("design_target_path") != targetPath {
		t.Fatalf("design_target_path = %q, want %q", query.Get("design_target_path"), targetPath)
	}
	if query.Get("design_revision") != payload.Revision {
		t.Fatalf("design_revision = %q, want %q", query.Get("design_revision"), payload.Revision)
	}

	if _, err := os.Stat(filepath.Join(fsStore.ThreadUserDataDir(threadID), "outputs", "designs", "landing-v2.op")); err != nil {
		t.Fatalf("expected explicit design document to be created: %v", err)
	}
}

func TestDesignBoardReadCanonicalizesOlderMinifiedDocument(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	fsStore := storage.NewFS(t.TempDir())
	userID := uuid.New()
	threadID := "thread-design"
	documentPath := filepath.Join(fsStore.ThreadUserDataDir(threadID), "outputs", "designs", "canvas.op")
	if err := os.MkdirAll(filepath.Dir(documentPath), 0o755); err != nil {
		t.Fatalf("mkdir design dir: %v", err)
	}
	if err := os.WriteFile(documentPath, []byte(`{"version":"1.0.0","children":[{"id":"hero","type":"frame"}]}`), 0o644); err != nil {
		t.Fatalf("write minified design document: %v", err)
	}

	handler := NewDesignBoardHandler(
		&stubDesignBoardRepo{record: &repository.ThreadRuntimeRecord{ThreadID: threadID}},
		service.NewDesignBoardService(fsStore),
		"design-secret",
		"",
	)

	openContext, openRecorder := newDesignAuthedContext(
		http.MethodPost,
		"/api/threads/"+threadID+"/design-board/open",
		"",
		userID,
	)
	openContext.Params = gin.Params{{Key: "id", Value: threadID}}
	handler.Open(openContext)
	if openRecorder.Code != http.StatusOK {
		t.Fatalf("open status = %d body=%s", openRecorder.Code, openRecorder.Body.String())
	}

	var session struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.Unmarshal(openRecorder.Body.Bytes(), &session); err != nil {
		t.Fatalf("unmarshal session: %v", err)
	}

	router := gin.New()
	router.GET("/api/design/document", handler.ReadDocument)

	readRequest := httptest.NewRequest(http.MethodGet, "/api/design/document", nil)
	readRequest.Header.Set("Authorization", "Bearer "+session.AccessToken)
	readRecorder := httptest.NewRecorder()
	router.ServeHTTP(readRecorder, readRequest)
	if readRecorder.Code != http.StatusOK {
		t.Fatalf("read status = %d body=%s", readRecorder.Code, readRecorder.Body.String())
	}

	normalizedDocument, err := os.ReadFile(documentPath)
	if err != nil {
		t.Fatalf("read normalized design document: %v", err)
	}
	if !strings.Contains(string(normalizedDocument), "\n  \"children\": [\n") {
		t.Fatalf("expected canonicalized multiline document, got %q", string(normalizedDocument))
	}
}
