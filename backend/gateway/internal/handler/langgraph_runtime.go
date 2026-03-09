package handler

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/openagents/gateway/internal/middleware"
)

type LangGraphRuntimeHandler struct{}

const (
	headerUserID   = "x-user-id"
	headerThreadID = "x-thread-id"
)

func NewLangGraphRuntimeHandler() *LangGraphRuntimeHandler {
	return &LangGraphRuntimeHandler{}
}

func (h *LangGraphRuntimeHandler) InjectRuntimeConfig() gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := middleware.GetUserID(c)
		threadID := extractThreadIDFromPath(c.Request.URL.Path)
		injectRuntimeHeaders(c.Request, userID, threadID)
		c.Next()
	}
}

func injectRuntimeHeaders(req *http.Request, userID uuid.UUID, threadID string) {
	if req == nil {
		return
	}
	if req.Header == nil {
		req.Header = make(http.Header)
	}
	if userID != uuid.Nil && req.Header.Get(headerUserID) == "" {
		req.Header.Set(headerUserID, userID.String())
	}
	if threadID != "" && req.Header.Get(headerThreadID) == "" {
		req.Header.Set(headerThreadID, threadID)
	}
}

func extractThreadIDFromPath(requestPath string) string {
	trimmed := strings.TrimPrefix(requestPath, "/api/langgraph/")
	parts := strings.Split(trimmed, "/")
	if len(parts) < 2 {
		return ""
	}
	if parts[0] != "threads" {
		return ""
	}
	threadID := strings.TrimSpace(parts[1])
	return threadID
}
