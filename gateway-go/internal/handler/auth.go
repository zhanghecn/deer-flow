package handler

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"net/http"

	"github.com/openagents/gateway/internal/middleware"
	"github.com/openagents/gateway/internal/model"
	"github.com/openagents/gateway/internal/repository"
	"github.com/openagents/gateway/pkg/jwt"
	"github.com/openagents/gateway/pkg/storage"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

type AuthHandler struct {
	userRepo  *repository.UserRepo
	tokenRepo *repository.APITokenRepo
	jwtMgr    *jwt.Manager
	fs        *storage.FS
}

func NewAuthHandler(userRepo *repository.UserRepo, tokenRepo *repository.APITokenRepo, jwtMgr *jwt.Manager, fs *storage.FS) *AuthHandler {
	return &AuthHandler{userRepo: userRepo, tokenRepo: tokenRepo, jwtMgr: jwtMgr, fs: fs}
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

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "internal error"})
		return
	}

	user := &model.User{
		ID:           uuid.New(),
		Email:        req.Email,
		Name:         req.Name,
		PasswordHash: string(hash),
		Role:         "user",
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

	c.JSON(http.StatusCreated, model.AuthResponse{Token: token, User: *user})
}

func (h *AuthHandler) Login(c *gin.Context) {
	var req model.LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}

	user, err := h.userRepo.FindByEmail(c.Request.Context(), req.Email)
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

	c.JSON(http.StatusOK, model.AuthResponse{Token: token, User: *user})
}

func (h *AuthHandler) ListTokens(c *gin.Context) {
	userID := middleware.GetUserID(c)
	tokens, err := h.tokenRepo.ListByUser(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to list tokens"})
		return
	}
	if tokens == nil {
		tokens = []model.APIToken{}
	}
	c.JSON(http.StatusOK, tokens)
}

func (h *AuthHandler) CreateToken(c *gin.Context) {
	var req model.CreateAPITokenRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}

	userID := middleware.GetUserID(c)

	// Generate random token
	plainToken := generateRandomToken()
	hash := hashTokenStr(plainToken)

	apiToken := &model.APIToken{
		ID:        uuid.New(),
		UserID:    userID,
		TokenHash: hash,
		Name:      req.Name,
		Scopes:    req.Scopes,
	}

	if err := h.tokenRepo.Create(c.Request.Context(), apiToken); err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to create token"})
		return
	}

	c.JSON(http.StatusCreated, model.APITokenResponse{
		APIToken:   *apiToken,
		PlainToken: plainToken,
	})
}

func (h *AuthHandler) DeleteToken(c *gin.Context) {
	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "invalid token id"})
		return
	}

	userID := middleware.GetUserID(c)
	if err := h.tokenRepo.Delete(c.Request.Context(), id, userID); err != nil {
		c.JSON(http.StatusNotFound, model.ErrorResponse{Error: "token not found"})
		return
	}

	c.JSON(http.StatusOK, model.SuccessResponse{Message: "token deleted"})
}

func generateRandomToken() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return "df_" + hex.EncodeToString(b)
}

func hashTokenStr(token string) string {
	h := sha256.Sum256([]byte(token))
	return hex.EncodeToString(h[:])
}
