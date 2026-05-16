package middleware

import (
	"bytes"
	"context"
	"encoding/json"
	"log"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/openagents/gateway/internal/model"
	"github.com/openagents/gateway/pkg/jwt"
	"github.com/openagents/gateway/pkg/storage"
)

type stubJWTUserRepo struct {
	users map[uuid.UUID]*model.User
}

func (s stubJWTUserRepo) FindByID(_ context.Context, userID uuid.UUID) (*model.User, error) {
	return s.users[userID], nil
}

type stubTrustedExternalTokenRepo struct {
	tokenByHash map[string]*model.APIToken
	managed     *model.APIToken
	created     []*model.APIToken
	lastUsed    []uuid.UUID
}

func (s *stubTrustedExternalTokenRepo) FindByHash(_ context.Context, hash string) (*model.APIToken, error) {
	return s.tokenByHash[hash], nil
}

func (s *stubTrustedExternalTokenRepo) UpdateLastUsed(_ context.Context, id uuid.UUID) error {
	s.lastUsed = append(s.lastUsed, id)
	return nil
}

func (s *stubTrustedExternalTokenRepo) Create(_ context.Context, token *model.APIToken) error {
	s.created = append(s.created, token)
	s.managed = token
	return nil
}

func (s *stubTrustedExternalTokenRepo) FindTrustedExternalManaged(_ context.Context, _ uuid.UUID, _ string) (*model.APIToken, error) {
	return s.managed, nil
}

type stubPublicAPIAgentLookupRepo struct {
	responseAgents map[string]string
	artifactAgents map[string]string
}

func (s stubPublicAPIAgentLookupRepo) FindAgentNameByResponseID(_ context.Context, responseID string) (string, error) {
	return s.responseAgents[strings.TrimSpace(responseID)], nil
}

func (s stubPublicAPIAgentLookupRepo) FindAgentNameByArtifactFileID(_ context.Context, fileID string) (string, error) {
	return s.artifactAgents[strings.TrimSpace(fileID)], nil
}

func TestExtractBearerTokenPrefersAuthorizationHeader(t *testing.T) {
	t.Parallel()

	req := httptest.NewRequest("GET", "http://example.com", nil)
	req.Header.Set("Authorization", "Bearer header-token")
	req.AddCookie(&http.Cookie{Name: AuthCookieName, Value: "cookie-token"})

	got := ExtractBearerToken(req)
	if got != "header-token" {
		t.Fatalf("expected header token, got %q", got)
	}
}

func TestExtractBearerTokenFallsBackToCookie(t *testing.T) {
	t.Parallel()

	req := httptest.NewRequest("GET", "http://example.com", nil)
	req.AddCookie(&http.Cookie{Name: AuthCookieName, Value: "cookie-token"})

	got := ExtractBearerToken(req)
	if got != "cookie-token" {
		t.Fatalf("expected cookie token, got %q", got)
	}
}

func TestExtractBearerTokenHandlesMissingCredentials(t *testing.T) {
	t.Parallel()

	req := httptest.NewRequest("GET", "http://example.com", nil)
	got := ExtractBearerToken(req)
	if got != "" {
		t.Fatalf("expected empty token, got %q", got)
	}
}

func TestExtractAPIBearerTokenIgnoresBrowserCookie(t *testing.T) {
	t.Parallel()

	req := httptest.NewRequest("GET", "http://example.com", nil)
	req.AddCookie(&http.Cookie{Name: AuthCookieName, Value: "cookie-token"})

	got, credential := extractAPIBearerToken(req)
	if got != "" {
		t.Fatalf("expected API token parser to ignore cookie token, got %q", got)
	}
	if !credential.CookiePresent || credential.AuthorizationHeader || credential.BearerScheme {
		t.Fatalf("unexpected credential flags: %#v", credential)
	}
}

func TestExtractAPIBearerTokenRequiresBearerHeader(t *testing.T) {
	t.Parallel()

	req := httptest.NewRequest("GET", "http://example.com", nil)
	req.Header.Set("Authorization", "Basic header-token")
	req.AddCookie(&http.Cookie{Name: AuthCookieName, Value: "cookie-token"})

	got, credential := extractAPIBearerToken(req)
	if got != "" {
		t.Fatalf("expected empty API token for non-bearer header, got %q", got)
	}
	if !credential.AuthorizationHeader || credential.BearerScheme || !credential.CookiePresent {
		t.Fatalf("unexpected credential flags: %#v", credential)
	}
}

func TestExtractAPIBearerTokenAcceptsCaseInsensitiveBearer(t *testing.T) {
	t.Parallel()

	req := httptest.NewRequest("GET", "http://example.com", nil)
	req.Header.Set("Authorization", "bearer header-token")

	got, credential := extractAPIBearerToken(req)
	if got != "header-token" {
		t.Fatalf("expected header token, got %q", got)
	}
	if !credential.AuthorizationHeader || !credential.BearerScheme || credential.CookiePresent {
		t.Fatalf("unexpected credential flags: %#v", credential)
	}
}

func TestAPITokenAuthLogsMissingHeaderWithoutLeakingSecrets(t *testing.T) {
	gin.SetMode(gin.TestMode)

	var logs bytes.Buffer
	originalOutput := log.Writer()
	log.SetOutput(&logs)
	defer log.SetOutput(originalOutput)

	router := gin.New()
	router.GET("/v1/models", APITokenAuth(nil), func(c *gin.Context) {
		t.Fatal("handler should not run without an API token header")
	})

	req := httptest.NewRequest(http.MethodGet, "/v1/models?api_key=secret-token", nil)
	req.Header.Set("User-Agent", "sdk-test")
	req.AddCookie(&http.Cookie{Name: AuthCookieName, Value: "cookie-token"})
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "missing api token") {
		t.Fatalf("expected missing-token response, got %s", rec.Body.String())
	}

	output := logs.String()
	for _, want := range []string{
		"public_api_auth_failure",
		"reason=missing",
		"route=/v1/models",
		"auth_header=false",
		"bearer=false",
		"cookie_present=true",
		`user_agent="sdk-test"`,
	} {
		if !strings.Contains(output, want) {
			t.Fatalf("expected log to contain %q, got %q", want, output)
		}
	}
	if strings.Contains(output, "secret-token") || strings.Contains(output, "api_key") || strings.Contains(output, "cookie-token") {
		t.Fatalf("auth failure log leaked a secret: %q", output)
	}
}

func TestAPITokenAuthFailureLogUsesTokenHashPrefix(t *testing.T) {
	gin.SetMode(gin.TestMode)

	var logs bytes.Buffer
	originalOutput := log.Writer()
	log.SetOutput(&logs)
	defer log.SetOutput(originalOutput)

	router := gin.New()
	router.GET("/v1/models", func(c *gin.Context) {
		logAPITokenAuthFailure(
			c,
			http.StatusUnauthorized,
			"invalid",
			apiBearerCredential{AuthorizationHeader: true, BearerScheme: true},
			"secret-token",
		)
		c.Status(http.StatusUnauthorized)
	})

	req := httptest.NewRequest(http.MethodGet, "/v1/models", nil)
	req.Header.Set("User-Agent", "sdk-test")
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	hashPrefix := hashToken("secret-token")[:12]
	output := logs.String()
	for _, want := range []string{
		"reason=invalid",
		"auth_header=true",
		"bearer=true",
		"token_len=12",
		"token_preview=sec...ken",
		"token_hash_prefix=" + hashPrefix,
	} {
		if !strings.Contains(output, want) {
			t.Fatalf("expected log to contain %q, got %q", want, output)
		}
	}
	if strings.Contains(output, "secret-token") {
		t.Fatalf("auth failure log leaked raw token: %q", output)
	}
}

func TestPublicAPIAgentAuthCreatesManagedKeyForTrustedExternalAgent(t *testing.T) {
	gin.SetMode(gin.TestMode)

	ownerID := uuid.New()
	fsStore := storage.NewFS(t.TempDir())
	if err := fsStore.WriteAgentFiles("support", "prod", "test", map[string]interface{}{
		"name":                 "support",
		"status":               "prod",
		"owner_user_id":        ownerID.String(),
		"public_api_auth_mode": model.PublicAPIAuthModeTrustedExternal,
	}); err != nil {
		t.Fatalf("write agent: %v", err)
	}

	repo := &stubTrustedExternalTokenRepo{tokenByHash: map[string]*model.APIToken{}}
	router := gin.New()
	router.POST(
		"/v1/turns",
		PublicAPIAgentAuth(repo, fsStore, PublicAPIBodyAgentField("agent")),
		RequireAPITokenScopes("responses:create"),
		func(c *gin.Context) {
			if got := GetUserID(c); got != ownerID {
				t.Fatalf("expected owner user id %s, got %s", ownerID, got)
			}
			if GetAPITokenID(c) == uuid.Nil {
				t.Fatal("expected managed token id in context")
			}
			var payload struct {
				Agent string `json:"agent"`
			}
			if err := c.ShouldBindJSON(&payload); err != nil {
				t.Fatalf("body was not restored for handler binding: %v", err)
			}
			if payload.Agent != "support" {
				t.Fatalf("expected request body agent to survive middleware, got %q", payload.Agent)
			}
			c.Status(http.StatusNoContent)
		},
	)

	req := httptest.NewRequest(http.MethodPost, "/v1/turns", strings.NewReader(`{"agent":"support"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d body=%s", rec.Code, rec.Body.String())
	}
	if len(repo.created) != 1 {
		t.Fatalf("expected one managed key creation, got %d", len(repo.created))
	}
	created := repo.created[0]
	if created.UserID != ownerID {
		t.Fatalf("expected managed key owner %s, got %s", ownerID, created.UserID)
	}
	if len(created.AllowedAgents) != 1 || created.AllowedAgents[0] != "support" {
		t.Fatalf("unexpected allowed agents: %#v", created.AllowedAgents)
	}
	var metadata map[string]any
	if err := json.Unmarshal(created.Metadata, &metadata); err != nil {
		t.Fatalf("managed key metadata is invalid: %v", err)
	}
	if metadata["source"] != "trusted_external_managed_key" || metadata["agent_name"] != "support" {
		t.Fatalf("unexpected managed key metadata: %#v", metadata)
	}
	if len(repo.lastUsed) != 1 || repo.lastUsed[0] != created.ID {
		t.Fatalf("expected managed key last_used update, got %#v", repo.lastUsed)
	}
}

func TestPublicAPIAgentAuthResolvesTrustedExternalAgentFromResponseAndArtifactIDs(t *testing.T) {
	gin.SetMode(gin.TestMode)

	ownerID := uuid.New()
	fsStore := storage.NewFS(t.TempDir())
	if err := fsStore.WriteAgentFiles("support", "prod", "test", map[string]interface{}{
		"name":                 "support",
		"status":               "prod",
		"owner_user_id":        ownerID.String(),
		"public_api_auth_mode": model.PublicAPIAuthModeTrustedExternal,
	}); err != nil {
		t.Fatalf("write agent: %v", err)
	}

	tokenRepo := &stubTrustedExternalTokenRepo{tokenByHash: map[string]*model.APIToken{}}
	lookupRepo := stubPublicAPIAgentLookupRepo{
		responseAgents: map[string]string{"resp_123": "support"},
		artifactAgents: map[string]string{"file_123": "support"},
	}
	router := gin.New()
	router.GET(
		"/v1/turns/:id",
		PublicAPIAgentAuth(tokenRepo, fsStore, PublicAPIResponseIDAgent(lookupRepo, "id")),
		RequireAPITokenScopes("responses:read"),
		func(c *gin.Context) {
			if got := GetUserID(c); got != ownerID {
				t.Fatalf("expected owner user id %s, got %s", ownerID, got)
			}
			if GetAPITokenID(c) == uuid.Nil {
				t.Fatal("expected managed token id for response lookup")
			}
			c.Status(http.StatusNoContent)
		},
	)
	router.GET(
		"/v1/files/:id/content",
		PublicAPIAgentAuth(tokenRepo, fsStore, PublicAPIArtifactFileAgent(lookupRepo, "id")),
		RequireAPITokenScopes("artifacts:read"),
		func(c *gin.Context) {
			if got := GetUserID(c); got != ownerID {
				t.Fatalf("expected owner user id %s, got %s", ownerID, got)
			}
			if GetAPITokenID(c) == uuid.Nil {
				t.Fatal("expected managed token id for artifact lookup")
			}
			c.Status(http.StatusNoContent)
		},
	)

	for _, path := range []string{"/v1/turns/resp_123", "/v1/files/file_123/content"} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusNoContent {
			t.Fatalf("expected 204 for %s, got %d body=%s", path, rec.Code, rec.Body.String())
		}
	}
	if len(tokenRepo.created) != 1 {
		t.Fatalf("expected one managed key shared by response and artifact lookups, got %d", len(tokenRepo.created))
	}
	if len(tokenRepo.lastUsed) != 2 {
		t.Fatalf("expected managed key last_used update for both lookups, got %#v", tokenRepo.lastUsed)
	}
}

func TestPublicAPIAgentAuthAllowsTrustedExternalMultipartFileUpload(t *testing.T) {
	gin.SetMode(gin.TestMode)

	ownerID := uuid.New()
	fsStore := storage.NewFS(t.TempDir())
	if err := fsStore.WriteAgentFiles("support", "prod", "test", map[string]interface{}{
		"name":                 "support",
		"status":               "prod",
		"owner_user_id":        ownerID.String(),
		"public_api_auth_mode": model.PublicAPIAuthModeTrustedExternal,
	}); err != nil {
		t.Fatalf("write agent: %v", err)
	}

	repo := &stubTrustedExternalTokenRepo{tokenByHash: map[string]*model.APIToken{}}
	router := gin.New()
	router.POST(
		"/v1/files",
		PublicAPIAgentAuth(repo, fsStore, PublicAPIFormAgentField("agent")),
		RequireAPITokenScopes("responses:create"),
		func(c *gin.Context) {
			if got := GetUserID(c); got != ownerID {
				t.Fatalf("expected owner user id %s, got %s", ownerID, got)
			}
			if GetAPITokenID(c) == uuid.Nil {
				t.Fatal("expected managed token id in context")
			}
			if got := c.PostForm("purpose"); got != "bazi_analysis" {
				t.Fatalf("expected purpose form field to survive middleware, got %q", got)
			}
			fileHeader, err := c.FormFile("file")
			if err != nil {
				t.Fatalf("expected upload file to survive middleware multipart parsing: %v", err)
			}
			if fileHeader.Filename != "chart.md" {
				t.Fatalf("expected uploaded filename chart.md, got %q", fileHeader.Filename)
			}
			c.Status(http.StatusNoContent)
		},
	)

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	if err := writer.WriteField("agent", "support"); err != nil {
		t.Fatalf("write agent field: %v", err)
	}
	if err := writer.WriteField("purpose", "bazi_analysis"); err != nil {
		t.Fatalf("write purpose field: %v", err)
	}
	fileWriter, err := writer.CreateFormFile("file", "chart.md")
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}
	if _, err := fileWriter.Write([]byte("# chart\n")); err != nil {
		t.Fatalf("write form file: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/v1/files", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d body=%s", rec.Code, rec.Body.String())
	}
	if len(repo.created) != 1 {
		t.Fatalf("expected one managed key creation for trusted upload, got %d", len(repo.created))
	}
	if len(repo.lastUsed) != 1 || repo.lastUsed[0] != repo.created[0].ID {
		t.Fatalf("expected managed key last_used update, got %#v", repo.lastUsed)
	}
}

func TestPublicAPIAgentAuthRequiresTokenForDefaultMultipartFileUpload(t *testing.T) {
	gin.SetMode(gin.TestMode)

	ownerID := uuid.New()
	fsStore := storage.NewFS(t.TempDir())
	if err := fsStore.WriteAgentFiles("support", "prod", "test", map[string]interface{}{
		"name":          "support",
		"status":        "prod",
		"owner_user_id": ownerID.String(),
	}); err != nil {
		t.Fatalf("write agent: %v", err)
	}

	repo := &stubTrustedExternalTokenRepo{tokenByHash: map[string]*model.APIToken{}}
	router := gin.New()
	router.POST(
		"/v1/files",
		PublicAPIAgentAuth(repo, fsStore, PublicAPIFormAgentField("agent")),
		func(c *gin.Context) {
			t.Fatal("handler should not run for api_key_required upload without token")
		},
	)

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	if err := writer.WriteField("agent", "support"); err != nil {
		t.Fatalf("write agent field: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/v1/files", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d body=%s", rec.Code, rec.Body.String())
	}
	if len(repo.created) != 0 {
		t.Fatalf("expected no managed key creation for default upload, got %d", len(repo.created))
	}
}

func TestPublicAPIAgentAuthStillRequiresTokenForDefaultAgent(t *testing.T) {
	gin.SetMode(gin.TestMode)

	ownerID := uuid.New()
	fsStore := storage.NewFS(t.TempDir())
	if err := fsStore.WriteAgentFiles("support", "prod", "test", map[string]interface{}{
		"name":          "support",
		"status":        "prod",
		"owner_user_id": ownerID.String(),
	}); err != nil {
		t.Fatalf("write agent: %v", err)
	}

	repo := &stubTrustedExternalTokenRepo{tokenByHash: map[string]*model.APIToken{}}
	router := gin.New()
	router.POST(
		"/v1/turns",
		PublicAPIAgentAuth(repo, fsStore, PublicAPIBodyAgentField("agent")),
		func(c *gin.Context) {
			t.Fatal("handler should not run for api_key_required agent without token")
		},
	)

	req := httptest.NewRequest(http.MethodPost, "/v1/turns", strings.NewReader(`{"agent":"support"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d body=%s", rec.Code, rec.Body.String())
	}
	if len(repo.created) != 0 {
		t.Fatalf("expected no managed key creation for default auth mode, got %d", len(repo.created))
	}
}

func TestPublicAPIAgentAuthUsesManagedKeyForTrustedExternalEvenWithBearerToken(t *testing.T) {
	gin.SetMode(gin.TestMode)

	ownerID := uuid.New()
	fsStore := storage.NewFS(t.TempDir())
	if err := fsStore.WriteAgentFiles("support", "prod", "test", map[string]interface{}{
		"name":                 "support",
		"status":               "prod",
		"owner_user_id":        ownerID.String(),
		"public_api_auth_mode": model.PublicAPIAuthModeTrustedExternal,
	}); err != nil {
		t.Fatalf("write agent: %v", err)
	}

	explicitToken := "customer-random-token"
	repo := &stubTrustedExternalTokenRepo{tokenByHash: map[string]*model.APIToken{}}
	router := gin.New()
	router.POST(
		"/v1/turns",
		PublicAPIAgentAuth(repo, fsStore, PublicAPIBodyAgentField("agent")),
		func(c *gin.Context) {
			if got := GetAPITokenID(c); got == uuid.Nil {
				t.Fatal("expected managed token id instead of rejecting caller-supplied bearer token")
			}
			c.Status(http.StatusNoContent)
		},
	)

	req := httptest.NewRequest(http.MethodPost, "/v1/turns", strings.NewReader(`{"agent":"support"}`))
	req.Header.Set("Authorization", "Bearer "+explicitToken)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d body=%s", rec.Code, rec.Body.String())
	}
	if len(repo.created) != 1 {
		t.Fatalf("expected managed key creation even when bearer token is present, got %d", len(repo.created))
	}
	if len(repo.lastUsed) != 1 || repo.lastUsed[0] != repo.created[0].ID {
		t.Fatalf("expected managed key last_used update, got %#v", repo.lastUsed)
	}
}

func TestPublicAPIAgentAuthUsesExplicitBearerTokenForAPIKeyRequiredAgent(t *testing.T) {
	gin.SetMode(gin.TestMode)

	ownerID := uuid.New()
	tokenID := uuid.New()
	fsStore := storage.NewFS(t.TempDir())
	if err := fsStore.WriteAgentFiles("support", "prod", "test", map[string]interface{}{
		"name":          "support",
		"status":        "prod",
		"owner_user_id": ownerID.String(),
	}); err != nil {
		t.Fatalf("write agent: %v", err)
	}

	explicitToken := "real-token"
	repo := &stubTrustedExternalTokenRepo{tokenByHash: map[string]*model.APIToken{
		hashToken(explicitToken): {
			ID:            tokenID,
			UserID:        ownerID,
			Status:        model.APITokenStatusActive,
			Scopes:        model.DefaultPublicAPIScopes(),
			AllowedAgents: []string{"support"},
		},
	}}
	router := gin.New()
	router.POST(
		"/v1/turns",
		PublicAPIAgentAuth(repo, fsStore, PublicAPIBodyAgentField("agent")),
		func(c *gin.Context) {
			if got := GetAPITokenID(c); got != tokenID {
				t.Fatalf("expected explicit token id %s, got %s", tokenID, got)
			}
			c.Status(http.StatusNoContent)
		},
	)

	req := httptest.NewRequest(http.MethodPost, "/v1/turns", strings.NewReader(`{"agent":"support"}`))
	req.Header.Set("Authorization", "Bearer "+explicitToken)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d body=%s", rec.Code, rec.Body.String())
	}
	if len(repo.created) != 0 {
		t.Fatalf("expected no managed key creation for api_key_required agent, got %d", len(repo.created))
	}
}

func TestMaskAPITokenForLogNeverReturnsRawLongToken(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		name  string
		token string
		want  string
	}{
		{name: "short", token: "abc123", want: "******"},
		{name: "medium", token: "secret-token", want: "sec...ken"},
		{name: "long", token: "customer-debug-token-001", want: "custom...-001"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			got := maskAPITokenForLog(tc.token)
			if got != tc.want {
				t.Fatalf("maskAPITokenForLog(%q) = %q, want %q", tc.token, got, tc.want)
			}
			if got == tc.token {
				t.Fatalf("maskAPITokenForLog returned raw token %q", got)
			}
		})
	}
}

func TestJWTAuthRejectsTokenForMissingUser(t *testing.T) {
	gin.SetMode(gin.TestMode)

	userID := uuid.New()
	jwtMgr := jwt.NewManager("test-secret", 1)
	token, err := jwtMgr.Generate(userID, "admin")
	if err != nil {
		t.Fatalf("generate token: %v", err)
	}

	router := gin.New()
	router.GET("/protected", JWTAuth(jwtMgr, stubJWTUserRepo{users: map[uuid.UUID]*model.User{}}), func(c *gin.Context) {
		t.Fatal("handler should not run for a stale user token")
	})

	req := httptest.NewRequest("GET", "/protected", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for missing token user, got %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestJWTAuthUsesCurrentUserRoleFromDatabase(t *testing.T) {
	gin.SetMode(gin.TestMode)

	userID := uuid.New()
	jwtMgr := jwt.NewManager("test-secret", 1)
	token, err := jwtMgr.Generate(userID, "user")
	if err != nil {
		t.Fatalf("generate token: %v", err)
	}

	router := gin.New()
	router.GET(
		"/protected",
		JWTAuth(jwtMgr, stubJWTUserRepo{users: map[uuid.UUID]*model.User{
			userID: {ID: userID, Role: "admin"},
		}}),
		func(c *gin.Context) {
			if got := GetRole(c); got != "admin" {
				t.Fatalf("expected current database role, got %q", got)
			}
			c.Status(http.StatusNoContent)
		},
	)

	req := httptest.NewRequest("GET", "/protected", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d body=%s", rec.Code, rec.Body.String())
	}
}
