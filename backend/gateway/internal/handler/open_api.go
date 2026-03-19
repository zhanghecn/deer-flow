package handler

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/openagents/gateway/internal/agentfs"
	"github.com/openagents/gateway/internal/middleware"
	"github.com/openagents/gateway/internal/model"
	"github.com/openagents/gateway/internal/repository"
	"github.com/openagents/gateway/pkg/storage"
)

type OpenAPIHandler struct {
	modelRepo    *repository.ModelRepo
	langGraphURL string
	fs           *storage.FS
}

const openAPIAssistantID = "lead_agent"

func NewOpenAPIHandler(modelRepo *repository.ModelRepo, langGraphURL string, fs *storage.FS) *OpenAPIHandler {
	return &OpenAPIHandler{modelRepo: modelRepo, langGraphURL: langGraphURL, fs: fs}
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

	// Verify the published agent exists on disk.
	agent, err := agentfs.LoadAgent(h.fs, agentName, "prod", false)
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

	modelName, err := h.resolveModelNameForRun(c, agent)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}

	// Ensure thread directories
	_ = h.fs.EnsureThreadDirs(threadID)
	if err := h.ensureLangGraphThread(c, userID, threadID); err != nil {
		c.JSON(http.StatusBadGateway, model.ErrorResponse{Error: "failed to initialize agent thread"})
		return
	}

	// Build LangGraph request using the same shape as the LangGraph SDK.
	lgBody := buildLangGraphRunRequest(agentName, threadID, modelName, req.Message)

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
	lgReq.Header.Set("X-User-ID", userID.String())

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

func (h *OpenAPIHandler) ensureLangGraphThread(c *gin.Context, userID uuid.UUID, threadID string) error {
	bodyBytes, err := json.Marshal(buildLangGraphThreadCreateRequest(threadID))
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(
		c.Request.Context(),
		http.MethodPost,
		h.langGraphURL+"/threads",
		bytes.NewReader(bodyBytes),
	)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-User-ID", userID.String())

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return nil
	}

	body, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
	return fmt.Errorf(
		"langgraph thread create failed: status %d: %s",
		resp.StatusCode,
		strings.TrimSpace(string(body)),
	)
}

func buildLangGraphThreadCreateRequest(threadID string) map[string]interface{} {
	return map[string]interface{}{
		"thread_id": threadID,
		"if_exists": "do_nothing",
		"metadata": map[string]interface{}{
			"graph_id": openAPIAssistantID,
		},
	}
}

func buildLangGraphRunRequest(agentName string, threadID string, modelName string, message string) map[string]interface{} {
	return map[string]interface{}{
		"assistant_id": openAPIAssistantID,
		"input": []map[string]interface{}{
			{"role": "user", "content": message},
		},
		"config": map[string]interface{}{
			"configurable": map[string]interface{}{
				"agent_name":   agentName,
				"agent_status": "prod",
				"thread_id":    threadID,
				"model_name":   modelName,
			},
		},
	}
}

func (h *OpenAPIHandler) resolveModelNameForRun(c *gin.Context, agent *model.Agent) (string, error) {
	if agent.Model == nil || strings.TrimSpace(*agent.Model) == "" {
		return "", fmt.Errorf("agent has no model configured; fallback selection is disabled")
	}

	row, err := h.modelRepo.FindEnabledByName(c.Request.Context(), *agent.Model)
	if err != nil {
		return "", fmt.Errorf("failed to load model %q: %w", *agent.Model, err)
	}
	if row == nil {
		return "", fmt.Errorf("agent model %q not found or disabled", *agent.Model)
	}

	return row.Name, nil
}

func (h *OpenAPIHandler) GetArtifact(c *gin.Context) {
	threadID := c.Param("tid")
	artifactPath := c.Param("path")
	if artifactPath == "" {
		head := c.Param("head")
		tail := c.Param("tail")
		if head != "" {
			artifactPath = "/" + head + tail
		}
	}

	ah := &ArtifactsHandler{fs: h.fs}
	c.Params = append(c.Params, gin.Param{Key: "id", Value: threadID})
	c.Params = append(c.Params, gin.Param{Key: "path", Value: artifactPath})
	ah.Serve(c)
}
