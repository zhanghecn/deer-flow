package handler

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/openagents/gateway/internal/agentfs"
	"github.com/openagents/gateway/internal/middleware"
	"github.com/openagents/gateway/internal/model"
	"github.com/openagents/gateway/pkg/jwt"
	"github.com/openagents/gateway/pkg/storage"
	"golang.org/x/crypto/bcrypt"
)

type AuthHandler struct {
	userRepo  authUserRepository
	tokenRepo authTokenRepository
	jwtMgr    *jwt.Manager
	// tokenCipher protects the owner-visible copy of API keys that powers the
	// management UI. Hashes remain the canonical auth check.
	tokenCipher *APITokenCipher
	fs          *storage.FS
}

type authUserRepository interface {
	FindByEmail(ctx context.Context, email string) (*model.User, error)
	FindByName(ctx context.Context, name string) (*model.User, error)
	FindByID(ctx context.Context, userID uuid.UUID) (*model.User, error)
	Count(ctx context.Context) (int64, error)
	Create(ctx context.Context, user *model.User) error
}

type authTokenRepository interface {
	Create(ctx context.Context, token *model.APIToken) error
	ListByUser(ctx context.Context, userID uuid.UUID) ([]model.APIToken, error)
	Revoke(ctx context.Context, id uuid.UUID, userID uuid.UUID) error
}

const authCookieMaxAgeSeconds = 7 * 24 * 60 * 60

var (
	errManagedTokenUnauthorized = errors.New("unauthorized")
	errInvalidManagedTokenUser  = errors.New("invalid user id")
	errLoadManagedTokenUser     = errors.New("failed to load user")
)

func NewAuthHandler(
	userRepo authUserRepository,
	tokenRepo authTokenRepository,
	jwtMgr *jwt.Manager,
	tokenCipher *APITokenCipher,
	fs *storage.FS,
) *AuthHandler {
	return &AuthHandler{
		userRepo:    userRepo,
		tokenRepo:   tokenRepo,
		jwtMgr:      jwtMgr,
		tokenCipher: tokenCipher,
		fs:          fs,
	}
}

func setAuthCookie(c *gin.Context, token string) {
	secure := c.Request.TLS != nil || strings.EqualFold(c.GetHeader("X-Forwarded-Proto"), "https")
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(middleware.AuthCookieName, token, authCookieMaxAgeSeconds, "/", "", secure, true)
}

func (h *AuthHandler) Register(c *gin.Context) {
	var req model.RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}

	existing, _ := h.userRepo.FindByEmail(c.Request.Context(), req.Email)
	if existing != nil {
		c.JSON(http.StatusConflict, model.ErrorResponse{Error: "email already registered"})
		return
	}
	existing, _ = h.userRepo.FindByName(c.Request.Context(), req.Name)
	if existing != nil {
		c.JSON(http.StatusConflict, model.ErrorResponse{Error: "account already registered"})
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "internal error"})
		return
	}

	role := "user"
	userCount, err := h.userRepo.Count(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to initialize user role"})
		return
	}
	if userCount == 0 {
		role = "admin"
	}

	user := &model.User{
		ID:           uuid.New(),
		Email:        req.Email,
		Name:         req.Name,
		PasswordHash: string(hash),
		Role:         role,
	}

	if err := h.userRepo.Create(c.Request.Context(), user); err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to create user"})
		return
	}

	// Create user directory
	_ = h.fs.EnsureUserDir(user.ID.String())

	token, err := h.jwtMgr.Generate(user.ID, user.Role)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to generate token"})
		return
	}

	setAuthCookie(c, token)
	c.JSON(http.StatusCreated, model.AuthResponse{Token: token, User: *user})
}

func (h *AuthHandler) Login(c *gin.Context) {
	var req model.LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}

	user, err := h.userRepo.FindByName(c.Request.Context(), req.Account)
	if err != nil || user == nil {
		c.JSON(http.StatusUnauthorized, model.ErrorResponse{Error: "invalid credentials"})
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		c.JSON(http.StatusUnauthorized, model.ErrorResponse{Error: "invalid credentials"})
		return
	}

	token, err := h.jwtMgr.Generate(user.ID, user.Role)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to generate token"})
		return
	}

	setAuthCookie(c, token)
	c.JSON(http.StatusOK, model.AuthResponse{Token: token, User: *user})
}

func (h *AuthHandler) GetSession(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == uuid.Nil {
		c.JSON(http.StatusUnauthorized, model.ErrorResponse{Error: "unauthorized"})
		return
	}

	user, err := h.userRepo.FindByID(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to load user"})
		return
	}
	if user == nil {
		c.JSON(http.StatusUnauthorized, model.ErrorResponse{Error: "user not found"})
		return
	}

	token := middleware.ExtractBearerToken(c.Request)
	if token == "" {
		c.JSON(http.StatusUnauthorized, model.ErrorResponse{Error: "missing authorization token"})
		return
	}

	// Refresh the browser session cookie so auth restoration and manual page
	// refreshes keep following the same single session lifetime contract.
	setAuthCookie(c, token)
	c.JSON(http.StatusOK, model.AuthResponse{Token: token, User: *user})
}

func (h *AuthHandler) resolveManagedTokenUserID(c *gin.Context) (uuid.UUID, error) {
	userID := middleware.GetUserID(c)
	if userID == uuid.Nil {
		return uuid.Nil, errManagedTokenUnauthorized
	}
	if !middleware.IsAdmin(c) {
		return userID, nil
	}

	targetUserIDText := managedTokenTargetUserParam(c)
	if targetUserIDText == "" {
		return userID, nil
	}

	targetUserID, err := uuid.Parse(targetUserIDText)
	if err != nil {
		return uuid.Nil, errInvalidManagedTokenUser
	}

	// Admin-managed keys still belong to a real persisted user row so audit and
	// revoke paths stay on the same single-source-of-truth tables as self-serve keys.
	targetUser, err := h.userRepo.FindByID(c.Request.Context(), targetUserID)
	if err != nil {
		return uuid.Nil, errLoadManagedTokenUser
	}
	if targetUser == nil {
		return uuid.Nil, pgx.ErrNoRows
	}

	return targetUserID, nil
}

func writeManagedTokenUserError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		c.JSON(http.StatusNotFound, model.ErrorResponse{Error: "user not found"})
	case errors.Is(err, errInvalidManagedTokenUser):
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
	case errors.Is(err, errLoadManagedTokenUser):
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: err.Error()})
	default:
		c.JSON(http.StatusUnauthorized, model.ErrorResponse{Error: err.Error()})
	}
}

func (h *AuthHandler) listTokensForUser(c *gin.Context, userID uuid.UUID) {
	if h.tokenCipher == nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "api token cipher is not configured"})
		return
	}

	tokens, err := h.tokenRepo.ListByUser(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to list tokens"})
		return
	}
	if tokens == nil {
		tokens = []model.APIToken{}
	}
	for index := range tokens {
		// Tokens created before the displayable-key contract only have hashes, so
		// they cannot be reconstructed here and must be rotated by the operator.
		if len(tokens[index].TokenCiphertext) == 0 {
			continue
		}

		plainToken, err := h.tokenCipher.DecryptToken(tokens[index].TokenCiphertext)
		if err != nil {
			c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to decrypt token"})
			return
		}
		tokens[index].Token = plainToken
	}
	c.JSON(http.StatusOK, tokens)
}

func (h *AuthHandler) ListTokens(c *gin.Context) {
	userID, err := h.resolveManagedTokenUserID(c)
	if err != nil {
		writeManagedTokenUserError(c, err)
		return
	}
	h.listTokensForUser(c, userID)
}

func (h *AuthHandler) createTokenForUser(c *gin.Context, userID uuid.UUID) {
	if h.tokenCipher == nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "api token cipher is not configured"})
		return
	}

	var req model.CreateAPITokenRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}

	metadata, err := model.ValidateAPITokenMetadata(req.Metadata)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}
	if req.ExpiresAt != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "expires_at is no longer supported"})
		return
	}

	allowedAgents, err := h.validateOwnedPublishedTokenAgents(
		userID,
		req.AllowedAgents,
		canCreateTokenForAnyPublishedAgent(c, userID),
	)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}

	plainToken := generateRandomToken()
	tokenCiphertext, err := h.tokenCipher.EncryptToken(plainToken)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to encrypt token"})
		return
	}
	apiToken := &model.APIToken{
		ID:              uuid.New(),
		UserID:          userID,
		TokenHash:       hashTokenStr(plainToken),
		TokenCiphertext: tokenCiphertext,
		TokenPrefix:     tokenPrefixFromToken(plainToken),
		Token:           plainToken,
		Name:            strings.TrimSpace(req.Name),
		Scopes:          model.NormalizeAPITokenScopes(req.Scopes),
		Status:          model.APITokenStatusActive,
		AllowedAgents:   allowedAgents,
		Metadata:        metadata,
		// The create response reuses this in-memory row immediately, so stamp the
		// timestamp here instead of returning the zero time and forcing callers to
		// refetch before they can display creation metadata.
		CreatedAt: time.Now().UTC(),
	}

	if err := h.tokenRepo.Create(c.Request.Context(), apiToken); err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to create token"})
		return
	}

	c.JSON(http.StatusCreated, apiToken)
}

func (h *AuthHandler) CreateToken(c *gin.Context) {
	userID, err := h.resolveManagedTokenUserID(c)
	if err != nil {
		writeManagedTokenUserError(c, err)
		return
	}
	h.createTokenForUser(c, userID)
}

func (h *AuthHandler) validateOwnedPublishedTokenAgents(
	userID uuid.UUID,
	requestedAgents []string,
	allowForeignOwned bool,
) ([]string, error) {
	normalizedAgents := model.NormalizeAPITokenAllowedAgents(requestedAgents)
	if len(normalizedAgents) != 1 {
		return nil, fmt.Errorf("allowed_agents must contain exactly one published agent")
	}

	agentName := normalizedAgents[0]
	// Public API keys now bind to one creator-owned prod agent so inventory,
	// audit logs, and downstream support work can reason about one credential ->
	// one agent without legacy broad-access ambiguity.
	agent, err := agentfs.LoadAgent(h.fs, agentName, "prod", false)
	if err != nil {
		return nil, fmt.Errorf("failed to load agent %q: %w", agentName, err)
	}
	if agent == nil {
		return nil, fmt.Errorf("published agent %q not found", agentName)
	}

	if !allowForeignOwned && strings.TrimSpace(agent.OwnerUserID) != userID.String() {
		return nil, fmt.Errorf("you can only create keys for prod agents you own")
	}

	return normalizedAgents, nil
}

func canCreateTokenForAnyPublishedAgent(c *gin.Context, tokenUserID uuid.UUID) bool {
	if !middleware.IsAdmin(c) {
		return false
	}

	targetUserIDText := managedTokenTargetUserParam(c)
	if targetUserIDText == "" {
		return true
	}

	targetUserID, err := uuid.Parse(targetUserIDText)
	if err != nil {
		return false
	}

	// Self-service admin key creation can target any published prod agent, but
	// admin-managed keys for another user must stay bound to that user's agents.
	return targetUserID == tokenUserID && targetUserID == middleware.GetUserID(c)
}

func managedTokenTargetUserParam(c *gin.Context) string {
	fullPath := strings.TrimSpace(c.FullPath())
	switch fullPath {
	case "/api/admin/users/:user_id/tokens":
		return strings.TrimSpace(c.Param("user_id"))
	case "/api/admin/users/:id/tokens/:token_id":
		return strings.TrimSpace(c.Param("id"))
	default:
		// Workspace self-service routes such as `/api/auth/tokens/:id` use `:id`
		// for the token row, not a managed user. Keep that namespace split so
		// admin self-service flows do not misread token IDs as user IDs.
		return ""
	}
}

func (h *AuthHandler) DeleteToken(c *gin.Context) {
	// Admin routes use `/users/:id/tokens/:token_id`, so prefer the explicit
	// token parameter instead of accidentally parsing the managed user ID.
	idStr := c.Param("token_id")
	if idStr == "" {
		idStr = c.Param("id")
	}
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "invalid token id"})
		return
	}

	userID, err := h.resolveManagedTokenUserID(c)
	if err != nil {
		writeManagedTokenUserError(c, err)
		return
	}
	// Keep token rows for audit and invocation joins even though the northbound
	// UI presents this action as deletion to the end user.
	if err := h.tokenRepo.Revoke(c.Request.Context(), id, userID); err != nil {
		c.JSON(http.StatusNotFound, model.ErrorResponse{Error: "token not found"})
		return
	}

	c.JSON(http.StatusOK, model.SuccessResponse{Message: "token revoked"})
}

func generateRandomToken() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return "df_" + hex.EncodeToString(b)
}

func tokenPrefixFromToken(token string) string {
	trimmed := strings.TrimSpace(token)
	if len(trimmed) <= 15 {
		return trimmed
	}
	// The prefix is a non-secret operator hint for logs and key rotation UX.
	return fmt.Sprintf("%s...", trimmed[:15])
}

func hashTokenStr(token string) string {
	h := sha256.Sum256([]byte(token))
	return hex.EncodeToString(h[:])
}
