package handler

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/deer-flow/gateway/internal/middleware"
	"github.com/deer-flow/gateway/internal/model"
	"github.com/deer-flow/gateway/internal/repository"
	"github.com/deer-flow/gateway/pkg/storage"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type OpenAPIHandler struct {
	agentRepo    *repository.AgentRepo
	langGraphURL string
	fs           *storage.FS
}

func NewOpenAPIHandler(agentRepo *repository.AgentRepo, langGraphURL string, fs *storage.FS) *OpenAPIHandler {
	return &OpenAPIHandler{agentRepo: agentRepo, langGraphURL: langGraphURL, fs: fs}
}

func (h *OpenAPIHandler) Chat(c *gin.Context) {
	agentName := c.Param("name")
	h.handleRequest(c, agentName, false)
}

func (h *OpenAPIHandler) Stream(c *gin.Context) {
	agentName := c.Param("name")
	h.handleRequest(c, agentName, true)
}

func (h *OpenAPIHandler) handleRequest(c *gin.Context, agentName string, stream bool) {
	var req model.OpenAPIChatRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}

	// Verify agent exists and is published
	agent, err := h.agentRepo.FindByName(c.Request.Context(), agentName)
	if err != nil || agent == nil {
		c.JSON(http.StatusNotFound, model.ErrorResponse{Error: "agent not found"})
		return
	}
	if agent.Status != "prod" {
		c.JSON(http.StatusForbidden, model.ErrorResponse{Error: "agent not published; only prod agents can be called via open API"})
		return
	}

	userID := middleware.GetUserID(c)
	threadID := req.ThreadID
	if threadID == "" {
		threadID = uuid.New().String()
	}

	// Ensure thread directories
	_ = h.fs.EnsureThreadDirs(threadID)

	// Build LangGraph request
	lgBody := map[string]interface{}{
		"input": []map[string]interface{}{
			{"role": "user", "content": req.Message},
		},
		"configurable": map[string]interface{}{
			"user_id":      userID.String(),
			"agent_name":   agentName,
			"agent_status": "prod",
			"thread_id":    threadID,
		},
	}

	bodyBytes, _ := json.Marshal(lgBody)

	// Choose endpoint based on stream mode
	endpoint := "/threads/" + threadID + "/runs"
	if stream {
		endpoint += "/stream"
	}

	lgReq, err := http.NewRequestWithContext(c.Request.Context(), http.MethodPost,
		h.langGraphURL+endpoint, bytes.NewReader(bodyBytes))
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to create request"})
		return
	}
	lgReq.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 10 * time.Minute}
	resp, err := client.Do(lgReq)
	if err != nil {
		c.JSON(http.StatusBadGateway, model.ErrorResponse{Error: "failed to connect to agent runtime"})
		return
	}
	defer resp.Body.Close()

	if stream {
		// SSE streaming
		c.Header("Content-Type", "text/event-stream")
		c.Header("Cache-Control", "no-cache")
		c.Header("Connection", "keep-alive")
		c.Header("X-Thread-ID", threadID)
		c.Status(resp.StatusCode)

		flusher, ok := c.Writer.(http.Flusher)
		buf := make([]byte, 4096)
		for {
			n, err := resp.Body.Read(buf)
			if n > 0 {
				c.Writer.Write(buf[:n])
				if ok {
					flusher.Flush()
				}
			}
			if err != nil {
				break
			}
		}
		// Send final done event
		fmt.Fprintf(c.Writer, "data: {\"event\":\"done\",\"data\":{\"thread_id\":\"%s\"}}\n\n", threadID)
		if ok {
			flusher.Flush()
		}
	} else {
		// Synchronous response
		body, _ := io.ReadAll(resp.Body)
		c.Header("X-Thread-ID", threadID)
		c.Data(resp.StatusCode, resp.Header.Get("Content-Type"), body)
	}
}

func (h *OpenAPIHandler) GetArtifact(c *gin.Context) {
	threadID := c.Param("tid")
	artifactPath := c.Param("path")

	ah := &ArtifactsHandler{fs: h.fs}
	c.Params = append(c.Params, gin.Param{Key: "id", Value: threadID})
	c.Params = append(c.Params, gin.Param{Key: "path", Value: artifactPath})
	ah.Serve(c)
}
