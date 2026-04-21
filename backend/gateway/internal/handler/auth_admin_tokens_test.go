package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/openagents/gateway/internal/middleware"
	"github.com/openagents/gateway/internal/model"
	"github.com/openagents/gateway/pkg/storage"
)

type stubAuthUserRepo struct {
	usersByID map[uuid.UUID]*model.User
}

func (s *stubAuthUserRepo) FindByEmail(_ context.Context, _ string) (*model.User, error) {
	return nil, nil
}

func (s *stubAuthUserRepo) FindByName(_ context.Context, _ string) (*model.User, error) {
	return nil, nil
}

func (s *stubAuthUserRepo) FindByID(_ context.Context, userID uuid.UUID) (*model.User, error) {
	return s.usersByID[userID], nil
}

func (s *stubAuthUserRepo) Count(_ context.Context) (int64, error) {
	return int64(len(s.usersByID)), nil
}

func (s *stubAuthUserRepo) Create(_ context.Context, _ *model.User) error {
	return nil
}

type stubAuthTokenRepo struct {
	listed      []model.APIToken
	created     *model.APIToken
	revokedID   uuid.UUID
	revokedUser uuid.UUID
}

func (s *stubAuthTokenRepo) Create(_ context.Context, token *model.APIToken) error {
	cloned := *token
	s.created = &cloned
	return nil
}

func (s *stubAuthTokenRepo) ListByUser(_ context.Context, _ uuid.UUID) ([]model.APIToken, error) {
	return s.listed, nil
}

func (s *stubAuthTokenRepo) Revoke(_ context.Context, id uuid.UUID, userID uuid.UUID) error {
	s.revokedID = id
	s.revokedUser = userID
	return nil
}

func TestAuthHandlerAdminCreateTokenTargetsSelectedUser(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	fsStore := storage.NewFS(t.TempDir())
	targetUserID := uuid.New()
	seedOwnedAgentArchive(t, fsStore, "reviewer", "prod", targetUserID.String())

	tokenRepo := &stubAuthTokenRepo{}
	cipher, err := NewAPITokenCipher("test-secret")
	if err != nil {
		t.Fatalf("build token cipher: %v", err)
	}
	handler := NewAuthHandler(
		&stubAuthUserRepo{
			usersByID: map[uuid.UUID]*model.User{
				targetUserID: {ID: targetUserID, Name: "target-user"},
			},
		},
		tokenRepo,
		nil,
		cipher,
		fsStore,
	)

	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set(string(middleware.UserIDKey), uuid.MustParse("11111111-1111-1111-1111-111111111111"))
		c.Set(string(middleware.RoleKey), "admin")
		c.Next()
	})
	router.POST("/api/admin/users/:user_id/tokens", handler.CreateToken)

	req := httptest.NewRequest(
		http.MethodPost,
		"/api/admin/users/"+targetUserID.String()+"/tokens",
		bytes.NewBufferString(`{"name":"support-key","allowed_agents":[" reviewer "]}`),
	)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d body=%s", rec.Code, rec.Body.String())
	}
	if tokenRepo.created == nil {
		t.Fatal("expected token repo create to be called")
	}
	if tokenRepo.created.UserID != targetUserID {
		t.Fatalf("created token user_id = %s, want %s", tokenRepo.created.UserID, targetUserID)
	}
	if len(tokenRepo.created.AllowedAgents) != 1 || tokenRepo.created.AllowedAgents[0] != "reviewer" {
		t.Fatalf("allowed agents = %#v, want [reviewer]", tokenRepo.created.AllowedAgents)
	}
}

func TestAuthHandlerAdminListTokensReadsSelectedUsersInventory(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	targetUserID := uuid.New()
	cipher, err := NewAPITokenCipher("test-secret")
	if err != nil {
		t.Fatalf("build token cipher: %v", err)
	}
	ciphertext, err := cipher.EncryptToken("df_visible_token")
	if err != nil {
		t.Fatalf("encrypt token: %v", err)
	}

	handler := NewAuthHandler(
		&stubAuthUserRepo{
			usersByID: map[uuid.UUID]*model.User{
				targetUserID: {ID: targetUserID, Name: "target-user"},
			},
		},
		&stubAuthTokenRepo{
			listed: []model.APIToken{
				{
					ID:              uuid.New(),
					UserID:          targetUserID,
					TokenCiphertext: ciphertext,
					Name:            "support-key",
					AllowedAgents:   []string{"reviewer"},
				},
			},
		},
		nil,
		cipher,
		storage.NewFS(t.TempDir()),
	)

	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set(string(middleware.UserIDKey), uuid.MustParse("11111111-1111-1111-1111-111111111111"))
		c.Set(string(middleware.RoleKey), "admin")
		c.Next()
	})
	router.GET("/api/admin/users/:user_id/tokens", handler.ListTokens)

	req := httptest.NewRequest(
		http.MethodGet,
		"/api/admin/users/"+targetUserID.String()+"/tokens",
		nil,
	)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}

	var payload []model.APIToken
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(payload) != 1 || payload[0].Token != "df_visible_token" {
		t.Fatalf("listed tokens = %#v, want visible token", payload)
	}
}

func TestAuthHandlerAdminDeleteTokenUsesTokenRouteParam(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	targetUserID := uuid.New()
	tokenID := uuid.New()
	tokenRepo := &stubAuthTokenRepo{}
	cipher, err := NewAPITokenCipher("test-secret")
	if err != nil {
		t.Fatalf("build token cipher: %v", err)
	}
	handler := NewAuthHandler(
		&stubAuthUserRepo{
			usersByID: map[uuid.UUID]*model.User{
				targetUserID: {ID: targetUserID, Name: "target-user"},
			},
		},
		tokenRepo,
		nil,
		cipher,
		storage.NewFS(t.TempDir()),
	)

	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set(string(middleware.UserIDKey), uuid.MustParse("11111111-1111-1111-1111-111111111111"))
		c.Set(string(middleware.RoleKey), "admin")
		c.Next()
	})
	router.DELETE("/api/admin/users/:id/tokens/:token_id", handler.DeleteToken)

	req := httptest.NewRequest(
		http.MethodDelete,
		"/api/admin/users/"+targetUserID.String()+"/tokens/"+tokenID.String(),
		nil,
	)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	if tokenRepo.revokedID != tokenID {
		t.Fatalf("revoked token id = %s, want %s", tokenRepo.revokedID, tokenID)
	}
	if tokenRepo.revokedUser != targetUserID {
		t.Fatalf("revoked user id = %s, want %s", tokenRepo.revokedUser, targetUserID)
	}
}

func TestAuthHandlerAdminSelfDeleteTokenUsesAuthenticatedUser(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	adminUserID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	tokenID := uuid.New()
	tokenRepo := &stubAuthTokenRepo{}
	cipher, err := NewAPITokenCipher("test-secret")
	if err != nil {
		t.Fatalf("build token cipher: %v", err)
	}
	handler := NewAuthHandler(
		&stubAuthUserRepo{
			usersByID: map[uuid.UUID]*model.User{
				adminUserID: {ID: adminUserID, Name: "admin-user"},
			},
		},
		tokenRepo,
		nil,
		cipher,
		storage.NewFS(t.TempDir()),
	)

	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set(string(middleware.UserIDKey), adminUserID)
		c.Set(string(middleware.RoleKey), "admin")
		c.Next()
	})
	router.DELETE("/api/auth/tokens/:id", handler.DeleteToken)

	req := httptest.NewRequest(
		http.MethodDelete,
		"/api/auth/tokens/"+tokenID.String(),
		nil,
	)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	if tokenRepo.revokedID != tokenID {
		t.Fatalf("revoked token id = %s, want %s", tokenRepo.revokedID, tokenID)
	}
	if tokenRepo.revokedUser != adminUserID {
		t.Fatalf("revoked user id = %s, want %s", tokenRepo.revokedUser, adminUserID)
	}
}
