package handler

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/openagents/gateway/internal/middleware"
	"github.com/openagents/gateway/internal/model"
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

		if c.Request.Body == nil || !isJSONRequest(c.Request.Method, c.ContentType()) {
			c.Next()
			return
		}

		originalBody, err := io.ReadAll(c.Request.Body)
		if err != nil {
			h.abortBadRequest(c, "failed to read request body")
			return
		}
		_ = c.Request.Body.Close()

		if len(bytes.TrimSpace(originalBody)) == 0 {
			restoreRequestBody(c, originalBody)
			c.Next()
			return
		}

		payload := map[string]interface{}{}
		if err := json.Unmarshal(originalBody, &payload); err != nil {
			// Non-object JSON payloads are forwarded untouched.
			restoreRequestBody(c, originalBody)
			c.Next()
			return
		}

		if userID != uuid.Nil {
			if err := injectContextValue(payload, "user_id", userID.String()); err != nil {
				h.abortBadRequest(c, err.Error())
				return
			}
		}
		if threadID != "" {
			if err := injectContextValue(payload, "thread_id", threadID); err != nil {
				h.abortBadRequest(c, err.Error())
				return
			}
		}

		modifiedBody, err := json.Marshal(payload)
		if err != nil {
			log.Printf(
				"[langgraph_runtime][error] method=%s path=%s user_id=%s err=%s",
				c.Request.Method,
				c.Request.URL.Path,
				formatUserID(userID),
				"failed to encode request body",
			)
			c.AbortWithStatusJSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to encode request body"})
			return
		}
		restoreRequestBody(c, modifiedBody)
		c.Next()
	}
}

func injectContextValue(payload map[string]interface{}, key, value string) error {
	contextPayload, err := ensureObjectField(payload, "context")
	if err != nil {
		return err
	}
	contextPayload[key] = value
	return nil
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

func ensureObjectField(parent map[string]interface{}, field string) (map[string]interface{}, error) {
	raw, exists := parent[field]
	if !exists || raw == nil {
		created := map[string]interface{}{}
		parent[field] = created
		return created, nil
	}
	asMap, ok := raw.(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("`%s` must be an object", field)
	}
	return asMap, nil
}

func restoreRequestBody(c *gin.Context, body []byte) {
	c.Request.Body = io.NopCloser(bytes.NewReader(body))
	c.Request.ContentLength = int64(len(body))
}

func (h *LangGraphRuntimeHandler) abortBadRequest(c *gin.Context, message string) {
	userID := middleware.GetUserID(c)
	log.Printf(
		"[langgraph_runtime][reject] method=%s path=%s user_id=%s error=%s",
		c.Request.Method,
		c.Request.URL.Path,
		formatUserID(userID),
		message,
	)
	c.AbortWithStatusJSON(http.StatusBadRequest, model.ErrorResponse{Error: message})
}

func formatUserID(userID uuid.UUID) string {
	if userID == uuid.Nil {
		return "-"
	}
	return userID.String()
}

func isJSONRequest(method, contentType string) bool {
	switch method {
	case http.MethodPost, http.MethodPut, http.MethodPatch:
	default:
		return false
	}
	return strings.HasPrefix(contentType, "application/json")
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
