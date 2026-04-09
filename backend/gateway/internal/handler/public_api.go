package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/openagents/gateway/internal/middleware"
	"github.com/openagents/gateway/internal/model"
	"github.com/openagents/gateway/internal/service"
)

type PublicAPIHandler struct {
	svc *service.PublicAPIService
}

func NewPublicAPIHandler(svc *service.PublicAPIService) *PublicAPIHandler {
	return &PublicAPIHandler{svc: svc}
}

func (h *PublicAPIHandler) ListModels(c *gin.Context) {
	response, err := h.svc.ListModels(c.Request.Context(), middleware.GetAPITokenAllowedAgents(c))
	if err != nil {
		writePublicAPIError(c, err)
		return
	}
	c.JSON(http.StatusOK, response)
}

func (h *PublicAPIHandler) CreateResponse(c *gin.Context) {
	rawBody, request, ok := bindPublicAPIJSON[model.PublicAPIResponsesRequest](c)
	if !ok {
		return
	}

	if request.Stream {
		startSSE(c)
		if err := h.svc.StreamResponse(
			c.Request.Context(),
			buildPublicAPIAuthContext(c),
			"responses",
			request,
			rawBody,
			func(eventName string, payload any) error {
				return writeSSE(c, eventName, payload)
			},
		); err != nil {
			_ = writeSSE(c, "error", gin.H{
				"error":   "runtime_error",
				"details": err.Error(),
			})
		}
		return
	}

	result, err := h.svc.CreateResponse(
		c.Request.Context(),
		buildPublicAPIAuthContext(c),
		"responses",
		request,
		rawBody,
	)
	if err != nil {
		writePublicAPIError(c, err)
		return
	}

	c.Data(http.StatusOK, "application/json", result.Body)
}

func (h *PublicAPIHandler) GetResponse(c *gin.Context) {
	responseBody, err := h.svc.GetResponse(
		c.Request.Context(),
		c.Param("id"),
		middleware.GetAPITokenID(c),
	)
	if err != nil {
		writePublicAPIError(c, err)
		return
	}
	c.Data(http.StatusOK, "application/json", responseBody)
}

func (h *PublicAPIHandler) GetFile(c *gin.Context) {
	fileObject, err := h.svc.GetFile(
		c.Request.Context(),
		c.Param("id"),
		middleware.GetAPITokenID(c),
	)
	if err != nil {
		writePublicAPIError(c, err)
		return
	}
	c.JSON(http.StatusOK, fileObject)
}

func (h *PublicAPIHandler) ChatCompletions(c *gin.Context) {
	rawBody, request, ok := bindPublicAPIJSON[model.PublicAPIChatCompletionsRequest](c)
	if !ok {
		return
	}

	canonicalRequest, err := translateChatCompletionsRequest(request)
	if err != nil {
		writePublicAPIError(c, err)
		return
	}

	if request.Stream {
		startSSE(c)
		if err := h.svc.StreamChatCompletions(
			c.Request.Context(),
			buildPublicAPIAuthContext(c),
			canonicalRequest,
			rawBody,
			request.StreamOptions != nil && request.StreamOptions.IncludeUsage,
			func(eventName string, payload any) error {
				return writeSSE(c, eventName, payload)
			},
		); err != nil {
			_ = writeSSE(c, "", "[DONE]")
		} else {
			_ = writeSSE(c, "", "[DONE]")
		}
		return
	}

	result, err := h.svc.CreateResponse(
		c.Request.Context(),
		buildPublicAPIAuthContext(c),
		"chat_completions",
		canonicalRequest,
		rawBody,
	)
	if err != nil {
		writePublicAPIError(c, err)
		return
	}

	chatCompletionBody, err := translateResponseToChatCompletion(result.Body)
	if err != nil {
		writePublicAPIError(c, err)
		return
	}
	c.Data(http.StatusOK, "application/json", chatCompletionBody)
}

func (h *PublicAPIHandler) GetFileContent(c *gin.Context) {
	fileResult, err := h.svc.GetFileContent(
		c.Request.Context(),
		c.Param("id"),
		middleware.GetAPITokenID(c),
	)
	if err != nil {
		writePublicAPIError(c, err)
		return
	}

	disposition := "inline"
	if strings.EqualFold(strings.TrimSpace(c.Query("download")), "true") {
		disposition = "attachment"
	}
	c.Header("Content-Disposition", disposition+`; filename="`+fileResult.Filename+`"`)
	c.Data(http.StatusOK, fileResult.ContentType, fileResult.Body)
}

func (h *PublicAPIHandler) CreateFile(c *gin.Context) {
	fileHeader, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "file is required"})
		return
	}

	fileObject, err := h.svc.UploadFile(
		c.Request.Context(),
		buildPublicAPIAuthContext(c),
		fileHeader,
		strings.TrimSpace(c.PostForm("purpose")),
	)
	if err != nil {
		writePublicAPIError(c, err)
		return
	}

	c.JSON(http.StatusOK, fileObject)
}

type PublicAPIAuditHandler struct {
	svc *service.PublicAPIService
}

func NewPublicAPIAuditHandler(svc *service.PublicAPIService) *PublicAPIAuditHandler {
	return &PublicAPIAuditHandler{svc: svc}
}

func (h *PublicAPIAuditHandler) ListInvocations(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == uuid.Nil {
		c.JSON(http.StatusUnauthorized, model.ErrorResponse{Error: "unauthorized"})
		return
	}

	filter := model.PublicAPIInvocationFilter{
		AgentName: strings.TrimSpace(c.Query("agent_name")),
		Limit:     parseQueryInt(c.Query("limit"), 50),
		Offset:    parseQueryInt(c.Query("offset"), 0),
	}
	if tokenIDText := strings.TrimSpace(c.Query("api_token_id")); tokenIDText != "" {
		tokenID, err := uuid.Parse(tokenIDText)
		if err != nil {
			c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "invalid api_token_id"})
			return
		}
		filter.APITokenID = &tokenID
	}

	items, err := h.svc.ListInvocations(c.Request.Context(), userID, filter)
	if err != nil {
		writePublicAPIError(c, err)
		return
	}
	if items == nil {
		items = []model.PublicAPIInvocation{}
	}

	c.JSON(http.StatusOK, gin.H{"items": items})
}

func buildPublicAPIAuthContext(c *gin.Context) service.PublicAPIAuthContext {
	clientIP := strings.TrimSpace(c.ClientIP())
	if clientIP == "" {
		clientIP = strings.TrimSpace(c.GetHeader("X-Forwarded-For"))
	}
	var clientIPPtr *string
	if clientIP != "" {
		clientIPPtr = &clientIP
	}

	userAgent := strings.TrimSpace(c.Request.UserAgent())
	var userAgentPtr *string
	if userAgent != "" {
		userAgentPtr = &userAgent
	}

	return service.PublicAPIAuthContext{
		UserID:        middleware.GetUserID(c),
		APITokenID:    middleware.GetAPITokenID(c),
		AllowedAgents: middleware.GetAPITokenAllowedAgents(c),
		ClientIP:      clientIPPtr,
		UserAgent:     userAgentPtr,
	}
}

func writePublicAPIError(c *gin.Context, err error) {
	if publicErr, ok := err.(*service.PublicAPIError); ok {
		c.JSON(publicErr.StatusCode, gin.H{
			"error":   publicErr.Code,
			"details": publicErr.Message,
		})
		return
	}
	c.JSON(http.StatusInternalServerError, gin.H{
		"error":   "internal_error",
		"details": err.Error(),
	})
}

func bindPublicAPIJSON[T any](c *gin.Context) (json.RawMessage, T, bool) {
	var zero T
	rawBody, err := c.GetRawData()
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "failed to read request body"})
		return nil, zero, false
	}
	c.Request.Body = ioNopCloser(bytes.NewReader(rawBody))

	var request T
	decoder := json.NewDecoder(bytes.NewReader(rawBody))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{
			Error:   "invalid request body",
			Details: err.Error(),
		})
		return nil, zero, false
	}
	return rawBody, request, true
}

func translateChatCompletionsRequest(
	request model.PublicAPIChatCompletionsRequest,
) (model.PublicAPIResponsesRequest, error) {
	input, err := json.Marshal(request.Messages)
	if err != nil {
		return model.PublicAPIResponsesRequest{}, err
	}

	translated := model.PublicAPIResponsesRequest{
		Model:    request.Model,
		Input:    input,
		Metadata: request.Metadata,
		Stream:   request.Stream,
	}

	if trimmedEffort := strings.TrimSpace(request.ReasoningEffort); trimmedEffort != "" {
		translated.Reasoning = &model.PublicAPIReasoning{
			Effort: trimmedEffort,
		}
	}

	switch {
	case request.MaxCompletionTokens != nil && request.MaxTokens != nil && *request.MaxCompletionTokens != *request.MaxTokens:
		return model.PublicAPIResponsesRequest{}, &service.PublicAPIError{
			StatusCode: http.StatusBadRequest,
			Code:       "invalid_max_tokens",
			Message:    "max_tokens and max_completion_tokens must match when both are provided",
		}
	case request.MaxCompletionTokens != nil:
		translated.MaxOutputTokens = request.MaxCompletionTokens
	case request.MaxTokens != nil:
		translated.MaxOutputTokens = request.MaxTokens
	}

	if request.ResponseFormat != nil {
		switch strings.ToLower(strings.TrimSpace(request.ResponseFormat.Type)) {
		case "json_schema":
			if request.ResponseFormat.JSONSchema == nil {
				return model.PublicAPIResponsesRequest{}, &service.PublicAPIError{
					StatusCode: http.StatusBadRequest,
					Code:       "invalid_response_format",
					Message:    "response_format.json_schema is required for json_schema mode",
				}
			}
			translated.Text = &model.PublicAPITextOptions{
				Format: &model.PublicAPITextFormat{
					Type:   "json_schema",
					Name:   request.ResponseFormat.JSONSchema.Name,
					Schema: request.ResponseFormat.JSONSchema.Schema,
					Strict: request.ResponseFormat.JSONSchema.Strict,
				},
			}
		case "json_object":
			translated.Text = &model.PublicAPITextOptions{
				Format: &model.PublicAPITextFormat{
					Type:   "json_schema",
					Name:   "json_object",
					Schema: json.RawMessage(`{"type":"object"}`),
					Strict: true,
				},
			}
		case "", "text":
		default:
			return model.PublicAPIResponsesRequest{}, &service.PublicAPIError{
				StatusCode: http.StatusBadRequest,
				Code:       "invalid_response_format",
				Message:    "unsupported response_format.type",
			}
		}
	}

	return translated, nil
}

func translateResponseToChatCompletion(responseBody json.RawMessage) (json.RawMessage, error) {
	var payload map[string]any
	if err := json.Unmarshal(responseBody, &payload); err != nil {
		return nil, err
	}

	metadata, _ := payload["metadata"].(map[string]any)
	if metadata == nil {
		metadata = map[string]any{}
	}
	openagentsMetadata, _ := metadata["openagents"].(map[string]any)
	if openagentsMetadata == nil {
		openagentsMetadata = map[string]any{}
	}
	openagentsMetadata["response_id"] = payload["id"]
	metadata["openagents"] = openagentsMetadata

	usage, _ := payload["usage"].(map[string]any)
	if usage == nil {
		usage = map[string]any{}
	}

	createdAt := int64(0)
	switch value := payload["created_at"].(type) {
	case float64:
		createdAt = int64(value)
	case int64:
		createdAt = value
	}

	chatCompletion := map[string]any{
		"id":      "chatcmpl_" + strings.TrimPrefix(strings.TrimSpace(stringValue(payload["id"])), "resp_"),
		"object":  "chat.completion",
		"created": createdAt,
		"model":   payload["model"],
		"choices": []map[string]any{
			{
				"index": 0,
				"message": map[string]any{
					"role":    "assistant",
					"content": payload["output_text"],
				},
				"finish_reason": "stop",
			},
		},
		"usage": map[string]any{
			"prompt_tokens":     usage["input_tokens"],
			"completion_tokens": usage["output_tokens"],
			"total_tokens":      usage["total_tokens"],
		},
		"metadata":  metadata,
		"artifacts": payload["artifacts"],
	}
	return json.Marshal(chatCompletion)
}

func startSSE(c *gin.Context) {
	c.Status(http.StatusOK)
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")
	if flusher, ok := c.Writer.(http.Flusher); ok {
		flusher.Flush()
	}
}

func writeSSE(c *gin.Context, eventName string, payload any) error {
	if eventName != "" {
		if _, err := c.Writer.WriteString("event: " + eventName + "\n"); err != nil {
			return err
		}
	}

	switch typed := payload.(type) {
	case string:
		if _, err := c.Writer.WriteString("data: " + typed + "\n\n"); err != nil {
			return err
		}
	default:
		encoded, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		if _, err := c.Writer.WriteString("data: " + string(encoded) + "\n\n"); err != nil {
			return err
		}
	}

	if flusher, ok := c.Writer.(http.Flusher); ok {
		flusher.Flush()
	}
	return nil
}

func parseQueryInt(raw string, fallback int) int {
	value, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil {
		return fallback
	}
	return value
}

func stringValue(value any) string {
	if text, ok := value.(string); ok {
		return text
	}
	return ""
}

type nopReadCloser struct {
	*bytes.Reader
}

func ioNopCloser(reader *bytes.Reader) nopReadCloser {
	return nopReadCloser{Reader: reader}
}

func (n nopReadCloser) Close() error {
	return nil
}
