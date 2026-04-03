package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	jwtv5 "github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/openagents/gateway/internal/middleware"
	"github.com/openagents/gateway/pkg/storage"
)

func TestOnlyOfficeConfigReturnsSignedPresentationConfig(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	baseDir := t.TempDir()
	threadID := "thread-office-config"
	deckPath := writeTestDeck(t, baseDir, threadID, "outputs", "deck.pptx", []byte("pptx"))

	handler := NewOnlyOfficeHandler(storage.NewFS(baseDir), OnlyOfficeConfig{
		ServerURL:    "http://onlyoffice.local",
		PublicAppURL: "http://gateway.local",
		JWTSecret:    "office-secret",
	})

	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(
		http.MethodGet,
		"/api/threads/"+threadID+"/office-config/outputs/deck.pptx?mode=edit",
		nil,
	)
	c.Params = gin.Params{
		{Key: "id", Value: threadID},
		{Key: "head", Value: "outputs"},
		{Key: "tail", Value: "/deck.pptx"},
	}
	c.Set(string(middleware.UserIDKey), uuid.MustParse("6098d570-33fa-40ad-a622-dd1525afbd41"))
	c.Set(string(middleware.RoleKey), "admin")

	handler.Config(c)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}

	var payload struct {
		DocumentServerURL string         `json:"documentServerUrl"`
		Config            map[string]any `json:"config"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if payload.DocumentServerURL != "http://onlyoffice.local" {
		t.Fatalf("unexpected document server url: %q", payload.DocumentServerURL)
	}

	document := payload.Config["document"].(map[string]any)
	if got := payload.Config["documentType"]; got != "slide" {
		t.Fatalf("unexpected document type: %v", got)
	}
	if got := document["fileType"]; got != "pptx" {
		t.Fatalf("unexpected file type: %v", got)
	}
	if got := document["url"]; got != "http://gateway.local/api/office/threads/"+threadID+"/files/outputs/deck.pptx" {
		t.Fatalf("unexpected document url: %v", got)
	}
	if got := document["title"]; got != filepath.Base(deckPath) {
		t.Fatalf("unexpected title: %v", got)
	}

	permissions := document["permissions"].(map[string]any)
	if got := permissions["edit"]; got != true {
		t.Fatalf("expected edit permission true, got %v", got)
	}

	editorConfig := payload.Config["editorConfig"].(map[string]any)
	if got := editorConfig["callbackUrl"]; got != "http://gateway.local/api/office/threads/"+threadID+"/callback/outputs/deck.pptx" {
		t.Fatalf("unexpected callback url: %v", got)
	}
	if got := editorConfig["mode"]; got != "edit" {
		t.Fatalf("unexpected editor mode: %v", got)
	}

	token, _ := payload.Config["token"].(string)
	if strings.TrimSpace(token) == "" {
		t.Fatalf("expected signed config token")
	}
	if _, err := jwtv5.Parse(token, func(t *jwtv5.Token) (interface{}, error) {
		return []byte("office-secret"), nil
	}); err != nil {
		t.Fatalf("expected valid signed token: %v", err)
	}
}

func TestOnlyOfficeConfigAllowsRelativeDocumentServerURL(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	baseDir := t.TempDir()
	threadID := "thread-office-relative"
	writeTestDeck(t, baseDir, threadID, "outputs", "deck.pptx", []byte("pptx"))

	handler := NewOnlyOfficeHandler(storage.NewFS(baseDir), OnlyOfficeConfig{
		ServerURL:    "/onlyoffice",
		PublicAppURL: "http://gateway.local",
		JWTSecret:    "office-secret",
	})

	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(
		http.MethodGet,
		"/api/threads/"+threadID+"/office-config/outputs/deck.pptx?mode=view",
		nil,
	)
	c.Params = gin.Params{
		{Key: "id", Value: threadID},
		{Key: "head", Value: "outputs"},
		{Key: "tail", Value: "/deck.pptx"},
	}
	c.Set(string(middleware.UserIDKey), uuid.MustParse("6098d570-33fa-40ad-a622-dd1525afbd41"))

	handler.Config(c)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}

	var payload struct {
		DocumentServerURL string `json:"documentServerUrl"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if payload.DocumentServerURL != "/onlyoffice" {
		t.Fatalf("unexpected document server url: %q", payload.DocumentServerURL)
	}
}

func TestOnlyOfficeConfigReturnsSpreadsheetConfig(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	baseDir := t.TempDir()
	threadID := "thread-office-sheet"
	writeTestDeck(t, baseDir, threadID, "outputs", "market.xlsx", []byte("xlsx"))

	handler := NewOnlyOfficeHandler(storage.NewFS(baseDir), OnlyOfficeConfig{
		ServerURL:    "http://onlyoffice.local",
		PublicAppURL: "http://gateway.local",
		JWTSecret:    "office-secret",
	})

	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(
		http.MethodGet,
		"/api/threads/"+threadID+"/office-config/outputs/market.xlsx?mode=edit",
		nil,
	)
	c.Params = gin.Params{
		{Key: "id", Value: threadID},
		{Key: "head", Value: "outputs"},
		{Key: "tail", Value: "/market.xlsx"},
	}
	c.Set(string(middleware.UserIDKey), uuid.MustParse("6098d570-33fa-40ad-a622-dd1525afbd41"))

	handler.Config(c)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}

	var payload struct {
		Config map[string]any `json:"config"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if got := payload.Config["documentType"]; got != "cell" {
		t.Fatalf("unexpected document type: %v", got)
	}

	document := payload.Config["document"].(map[string]any)
	permissions := document["permissions"].(map[string]any)
	if got := permissions["edit"]; got != true {
		t.Fatalf("expected edit permission true, got %v", got)
	}
}

func TestOnlyOfficeConfigFallsBackToViewForLegacyOfficeFiles(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	baseDir := t.TempDir()
	threadID := "thread-office-legacy"
	writeTestDeck(t, baseDir, threadID, "outputs", "legacy.ppt", []byte("ppt"))

	handler := NewOnlyOfficeHandler(storage.NewFS(baseDir), OnlyOfficeConfig{
		ServerURL:    "http://onlyoffice.local",
		PublicAppURL: "http://gateway.local",
		JWTSecret:    "office-secret",
	})

	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(
		http.MethodGet,
		"/api/threads/"+threadID+"/office-config/outputs/legacy.ppt?mode=edit",
		nil,
	)
	c.Params = gin.Params{
		{Key: "id", Value: threadID},
		{Key: "head", Value: "outputs"},
		{Key: "tail", Value: "/legacy.ppt"},
	}
	c.Set(string(middleware.UserIDKey), uuid.MustParse("6098d570-33fa-40ad-a622-dd1525afbd41"))

	handler.Config(c)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}

	var payload struct {
		Config map[string]any `json:"config"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	editorConfig := payload.Config["editorConfig"].(map[string]any)
	if got := editorConfig["mode"]; got != "view" {
		t.Fatalf("expected legacy office mode to fall back to view, got %v", got)
	}

	document := payload.Config["document"].(map[string]any)
	permissions := document["permissions"].(map[string]any)
	if got := permissions["edit"]; got != false {
		t.Fatalf("expected edit permission false, got %v", got)
	}
}

func TestOnlyOfficeFileServesArtifactForAuthorizedRequest(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	baseDir := t.TempDir()
	threadID := "thread-office-file"
	writeTestDeck(t, baseDir, threadID, "outputs", "market report.pptx", []byte("pptx-binary"))

	handler := NewOnlyOfficeHandler(storage.NewFS(baseDir), OnlyOfficeConfig{
		ServerURL: "http://onlyoffice.local",
		JWTSecret: "office-secret",
	})

	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(
		http.MethodGet,
		"/api/office/threads/"+threadID+"/files/outputs/market%20report.pptx",
		nil,
	)
	c.Request.Header.Set("Authorization", "Bearer "+signOnlyOfficeTestToken(t, "office-secret"))
	c.Params = gin.Params{
		{Key: "id", Value: threadID},
		{Key: "head", Value: "outputs"},
		{Key: "tail", Value: "/market%20report.pptx"},
	}

	handler.File(c)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	if rec.Body.String() != "pptx-binary" {
		t.Fatalf("unexpected file body: %q", rec.Body.String())
	}
}

func TestOnlyOfficeCallbackDownloadsAndReplacesPresentation(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	baseDir := t.TempDir()
	threadID := "thread-office-callback"
	deckPath := writeTestDeck(t, baseDir, threadID, "outputs", "deck.pptx", []byte("before"))

	downloadServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("after"))
	}))
	defer downloadServer.Close()

	handler := NewOnlyOfficeHandler(storage.NewFS(baseDir), OnlyOfficeConfig{
		ServerURL: "http://onlyoffice.local",
		JWTSecret: "office-secret",
	})

	body := map[string]any{
		"status": 2,
		"url":    downloadServer.URL + "/updated.pptx",
		"token":  signOnlyOfficeTestToken(t, "office-secret"),
	}
	bodyBytes, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal callback body: %v", err)
	}

	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(
		http.MethodPost,
		"/api/office/threads/"+threadID+"/callback/outputs/deck.pptx",
		bytes.NewReader(bodyBytes),
	)
	c.Request = c.Request.WithContext(context.Background())
	c.Request.Header.Set("Content-Type", "application/json")
	c.Params = gin.Params{
		{Key: "id", Value: threadID},
		{Key: "head", Value: "outputs"},
		{Key: "tail", Value: "/deck.pptx"},
	}

	handler.Callback(c)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	gotBytes, err := os.ReadFile(deckPath)
	if err != nil {
		t.Fatalf("read updated deck: %v", err)
	}
	if string(gotBytes) != "after" {
		t.Fatalf("expected updated file contents, got %q", string(gotBytes))
	}
}

func TestOnlyOfficeCallbackRewritesBrowserFacingDownloadURLToInternalServer(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	baseDir := t.TempDir()
	threadID := "thread-office-callback-rewrite"
	deckPath := writeTestDeck(t, baseDir, threadID, "outputs", "deck.docx", []byte("before"))

	downloadServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/cache/files/data/save-1/output.docx/output.docx" {
			t.Fatalf("unexpected rebased path: %s", r.URL.Path)
		}
		if got := r.URL.Query().Get("filename"); got != "output.docx" {
			t.Fatalf("unexpected filename query: %s", got)
		}
		_, _ = w.Write([]byte("after"))
	}))
	defer downloadServer.Close()

	handler := NewOnlyOfficeHandler(storage.NewFS(baseDir), OnlyOfficeConfig{
		ServerURL:         "/onlyoffice",
		InternalServerURL: downloadServer.URL,
		JWTSecret:         "office-secret",
	})

	body := map[string]any{
		"status": 2,
		"url":    "http://localhost:8083/onlyoffice/cache/files/data/save-1/output.docx/output.docx?filename=output.docx",
		"token":  signOnlyOfficeTestToken(t, "office-secret"),
	}
	bodyBytes, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal callback body: %v", err)
	}

	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(
		http.MethodPost,
		"/api/office/threads/"+threadID+"/callback/outputs/deck.docx",
		bytes.NewReader(bodyBytes),
	)
	c.Request = c.Request.WithContext(context.Background())
	c.Request.Header.Set("Content-Type", "application/json")
	c.Params = gin.Params{
		{Key: "id", Value: threadID},
		{Key: "head", Value: "outputs"},
		{Key: "tail", Value: "/deck.docx"},
	}

	handler.Callback(c)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	gotBytes, err := os.ReadFile(deckPath)
	if err != nil {
		t.Fatalf("read updated deck: %v", err)
	}
	if string(gotBytes) != "after" {
		t.Fatalf("expected updated file contents, got %q", string(gotBytes))
	}
}

func writeTestDeck(
	t *testing.T,
	baseDir string,
	threadID string,
	scope string,
	name string,
	content []byte,
) string {
	t.Helper()

	path := filepath.Join(baseDir, "threads", threadID, "user-data", scope, name)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir deck dir: %v", err)
	}
	if err := os.WriteFile(path, content, 0o644); err != nil {
		t.Fatalf("write deck: %v", err)
	}
	return path
}

func signOnlyOfficeTestToken(t *testing.T, secret string) string {
	t.Helper()

	token := jwtv5.NewWithClaims(jwtv5.SigningMethodHS256, jwtv5.MapClaims{
		"scope": "onlyoffice",
	})
	signed, err := token.SignedString([]byte(secret))
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}
	return signed
}
