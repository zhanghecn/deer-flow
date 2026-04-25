package service

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/openagents/gateway/internal/agentfs"
	"github.com/openagents/gateway/internal/httpx"
	"github.com/openagents/gateway/internal/model"
	"github.com/openagents/gateway/internal/repository"
	"github.com/openagents/gateway/internal/threadartifacts"
	"github.com/openagents/gateway/internal/uploadutil"
	"github.com/openagents/gateway/pkg/storage"
	"github.com/xeipuuv/gojsonschema"
)

const publicAPIAssistantID = "lead_agent"

var errArtifactNotFound = errors.New("artifact not found")

type PublicAPIError struct {
	StatusCode int
	Code       string
	Message    string
}

func (e *PublicAPIError) Error() string {
	return e.Message
}

type PublicAPIAuthContext struct {
	UserID        uuid.UUID
	APITokenID    uuid.UUID
	AllowedAgents []string
	ClientIP      *string
	UserAgent     *string
}

type PublicAPIResponseResult struct {
	ResponseID string
	ThreadID   string
	Body       json.RawMessage
}

type PublicAPIFileResult struct {
	Body        []byte
	ContentType string
	Filename    string
}

type publicAPINormalizedReasoning struct {
	ThinkingEnabled bool
	Effort          string
	Summary         string
}

type publicAPINormalizedInput struct {
	PromptText string
	FileIDs    []string
}

type publicAPIRuntimeUpload struct {
	Filename     string
	Size         int64
	MarkdownFile string
}

type publicAPIRunPlan struct {
	Auth               PublicAPIAuthContext
	Surface            string
	Request            model.PublicAPIResponsesRequest
	RequestJSON        json.RawMessage
	Invocation         *model.PublicAPIInvocation
	AgentName          string
	ModelName          string
	ThreadID           string
	ResponseID         string
	PreviousResponseID string
	Metadata           map[string]any
	PromptText         string
	RuntimeUploads     []publicAPIRuntimeUpload
	Reasoning          publicAPINormalizedReasoning
	MaxOutputTokens    *int
}

type publicAPIRunResult struct {
	Body           json.RawMessage
	OutputText     string
	ReasoningText  string
	ResponseObject map[string]any
	Incomplete     bool
}

type publicAPIRuntimeEventRecord struct {
	RunEvents []model.PublicAPIRunEvent
}

type pendingPublicAPIToolCall struct {
	ToolName string
	ToolArgs any
}

type publicAPIRunCollector struct {
	events                []model.PublicAPIRunEvent
	sequence              int
	activeToolPhaseCounts map[string]int
	activeToolCallKeys    map[string]int
	pendingToolCallKeys   map[string]pendingPublicAPIToolCall
	startedToolCallKeys   map[string]struct{}
}

type publicAPIModelRepository interface {
	FindEnabledByName(ctx context.Context, name string) (*repository.ModelRecord, error)
}

type publicAPIInputFileRepository interface {
	Create(ctx context.Context, file *model.PublicAPIInputFile) error
	GetByFileID(ctx context.Context, fileID string, apiTokenID uuid.UUID) (*model.PublicAPIInputFile, error)
}

type publicAPIInvocationRepository interface {
	Create(ctx context.Context, invocation *model.PublicAPIInvocation) error
	Finish(ctx context.Context, invocation *model.PublicAPIInvocation) error
	AttachArtifacts(ctx context.Context, artifacts []model.PublicAPIArtifact) error
	GetByResponseID(ctx context.Context, responseID string, apiTokenID uuid.UUID) (*model.PublicAPIInvocation, error)
	GetArtifactByFileID(ctx context.Context, fileID string, apiTokenID uuid.UUID) (*model.PublicAPIArtifact, *model.PublicAPIInvocation, error)
	ListByUser(ctx context.Context, userID uuid.UUID, filter model.PublicAPIInvocationFilter) ([]model.PublicAPIInvocation, error)
}

type publicAPITraceRepository interface {
	FindLatestByThreadAndUser(ctx context.Context, threadID string, userID uuid.UUID) (*repository.AgentTraceRecord, error)
}

type PublicAPIService struct {
	modelRepo      publicAPIModelRepository
	inputFileRepo  publicAPIInputFileRepository
	invocationRepo publicAPIInvocationRepository
	traceRepo      publicAPITraceRepository
	langGraphURL   string
	httpClient     *http.Client
	fs             *storage.FS
}

func NewPublicAPIService(
	modelRepo publicAPIModelRepository,
	inputFileRepo publicAPIInputFileRepository,
	invocationRepo publicAPIInvocationRepository,
	traceRepo publicAPITraceRepository,
	langGraphURL string,
	fs *storage.FS,
) *PublicAPIService {
	return &PublicAPIService{
		modelRepo:      modelRepo,
		inputFileRepo:  inputFileRepo,
		invocationRepo: invocationRepo,
		traceRepo:      traceRepo,
		langGraphURL:   strings.TrimRight(langGraphURL, "/"),
		httpClient:     httpx.NewInternalHTTPClient(10 * time.Minute),
		fs:             fs,
	}
}

func (s *PublicAPIService) ListModels(ctx context.Context, allowedAgents []string) (*model.PublicAPIModelsResponse, error) {
	agents, err := agentfs.ListAgents(s.fs, "prod")
	if err != nil {
		return nil, err
	}

	allowedSet := make(map[string]struct{}, len(allowedAgents))
	for _, agentName := range allowedAgents {
		normalized := strings.ToLower(strings.TrimSpace(agentName))
		if normalized != "" {
			allowedSet[normalized] = struct{}{}
		}
	}

	items := make([]model.PublicAPIModelCard, 0, len(agents))
	for _, agent := range agents {
		if agent.Status != "prod" {
			continue
		}
		// `/v1/models` should only advertise callable published agents. Surfacing
		// archives with no bound model or a disabled backing model creates a false
		// discovery contract because the next `/v1/responses` call must reject them.
		if agent.Model == nil || strings.TrimSpace(*agent.Model) == "" {
			continue
		}
		if s.modelRepo != nil {
			row, err := s.modelRepo.FindEnabledByName(ctx, strings.TrimSpace(*agent.Model))
			if err != nil {
				return nil, err
			}
			if row == nil {
				continue
			}
		}
		normalizedAgentName := strings.ToLower(strings.TrimSpace(agent.Name))
		if len(allowedSet) > 0 {
			if _, ok := allowedSet[normalizedAgentName]; !ok {
				continue
			}
		}

		items = append(items, model.PublicAPIModelCard{
			ID:      agent.Name,
			Object:  "model",
			Created: s.lookupAgentCreatedAt(agent.Name),
			OwnedBy: "openagents",
		})
	}

	slices.SortFunc(items, func(left, right model.PublicAPIModelCard) int {
		return strings.Compare(left.ID, right.ID)
	})

	return &model.PublicAPIModelsResponse{
		Object: "list",
		Data:   items,
	}, nil
}

func (s *PublicAPIService) UploadFile(
	ctx context.Context,
	auth PublicAPIAuthContext,
	header *multipart.FileHeader,
	purpose string,
) (*model.PublicAPIFileObject, error) {
	if s.inputFileRepo == nil {
		return nil, &PublicAPIError{
			StatusCode: http.StatusInternalServerError,
			Code:       "upload_unavailable",
			Message:    "public file uploads are not configured",
		}
	}

	normalizedPurpose := strings.TrimSpace(purpose)
	if normalizedPurpose == "" {
		return nil, &PublicAPIError{
			StatusCode: http.StatusBadRequest,
			Code:       "invalid_purpose",
			Message:    "purpose is required",
		}
	}

	filename := sanitizePublicUploadFilename(header.Filename)
	if filename == "" {
		return nil, &PublicAPIError{
			StatusCode: http.StatusBadRequest,
			Code:       "invalid_file",
			Message:    "file is required",
		}
	}

	fileID := newPublicFileID()
	storageRef := path.Join("users", auth.UserID.String(), "public-api-inputs", fileID, filename)
	filePath, err := s.resolveBaseStoragePath(storageRef)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(filePath), 0o755); err != nil {
		return nil, err
	}

	src, err := header.Open()
	if err != nil {
		return nil, err
	}
	defer src.Close()

	dst, err := os.Create(filePath)
	if err != nil {
		return nil, err
	}

	hasher := sha256.New()
	sizeBytes, copyErr := io.Copy(io.MultiWriter(dst, hasher), src)
	closeErr := dst.Close()
	if copyErr != nil {
		_ = os.Remove(filePath)
		return nil, copyErr
	}
	if closeErr != nil {
		_ = os.Remove(filePath)
		return nil, closeErr
	}

	mimeType := strings.TrimSpace(header.Header.Get("Content-Type"))
	if mimeType == "" {
		mimeType = guessMimeType(filePath)
	}
	sha256Value := hex.EncodeToString(hasher.Sum(nil))
	record := &model.PublicAPIInputFile{
		ID:         uuid.New(),
		FileID:     fileID,
		APITokenID: auth.APITokenID,
		UserID:     auth.UserID,
		Purpose:    normalizedPurpose,
		Filename:   filename,
		StorageRef: storageRef,
		MimeType:   &mimeType,
		SizeBytes:  sizeBytes,
		SHA256:     &sha256Value,
		CreatedAt:  time.Now().UTC(),
	}
	if err := s.inputFileRepo.Create(ctx, record); err != nil {
		_ = os.Remove(filePath)
		return nil, err
	}

	return buildPublicAPIFileObject(record), nil
}

func (s *PublicAPIService) CreateResponse(
	ctx context.Context,
	auth PublicAPIAuthContext,
	surface string,
	request model.PublicAPIResponsesRequest,
	requestJSON json.RawMessage,
) (*PublicAPIResponseResult, error) {
	plan, err := s.prepareRun(ctx, auth, surface, request, requestJSON)
	if err != nil {
		return nil, err
	}

	result, err := s.executeRun(ctx, plan, nil)
	if err != nil {
		return nil, s.finishInvocationWithError(ctx, plan.Invocation, err, nil)
	}

	return &PublicAPIResponseResult{
		ResponseID: plan.ResponseID,
		ThreadID:   plan.ThreadID,
		Body:       result.Body,
	}, nil
}

// StreamResponse keeps the northbound `/v1/responses` surface stable while the
// gateway emits a small normalized run-event contract instead of raw runtime
// categories. The larger debug trace remains a separate operator lane.
func (s *PublicAPIService) StreamResponse(
	ctx context.Context,
	auth PublicAPIAuthContext,
	surface string,
	request model.PublicAPIResponsesRequest,
	requestJSON json.RawMessage,
	emit func(eventName string, payload any) error,
) error {
	plan, err := s.prepareRun(ctx, auth, surface, request, requestJSON)
	if err != nil {
		return err
	}
	nextEventIndex := 1
	emittedRunEvents := []model.PublicAPIRunEvent{
		{
			EventIndex: nextEventIndex,
			CreatedAt:  plan.Invocation.CreatedAt.Unix(),
			Type:       model.PublicAPIRunStarted,
			ResponseID: plan.ResponseID,
		},
	}

	if err := emit(
		"response.run_event",
		buildStreamingRunEventEnvelope(
			emittedRunEvents[0],
		),
	); err != nil {
		return err
	}

	result, err := s.executeRun(ctx, plan, func(record publicAPIRuntimeEventRecord) error {
		for _, event := range record.RunEvents {
			nextEventIndex = event.EventIndex
			emittedRunEvents = append(emittedRunEvents, event)
			if err := emit("response.run_event", buildStreamingRunEventEnvelope(event)); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		failed := model.PublicAPIRunEvent{
			EventIndex: nextEventIndex + 1,
			CreatedAt:  time.Now().UTC().Unix(),
			Type:       model.PublicAPIRunFailed,
			ResponseID: plan.ResponseID,
			Error:      strings.TrimSpace(err.Error()),
		}
		if emitErr := emit("response.run_event", buildStreamingRunEventEnvelope(failed)); emitErr != nil {
			return emitErr
		}
		emittedRunEvents = append(emittedRunEvents, failed)
		_ = s.finishInvocationWithError(ctx, plan.Invocation, err, emittedRunEvents)
		return nil
	}
	if !result.Incomplete {
		for _, event := range buildTerminalRunEvents(nextEventIndex, plan.Invocation.ResponseID, result.OutputText) {
			nextEventIndex = event.EventIndex
			emittedRunEvents = append(emittedRunEvents, event)
			if err := emit("response.run_event", buildStreamingRunEventEnvelope(event)); err != nil {
				return err
			}
		}
	}
	return nil
}

// StreamChatCompletions keeps the stream wire format identical to standard chat
// completion chunks so existing SDKs can consume it without understanding the
// richer OpenAgents extension events.
func (s *PublicAPIService) StreamChatCompletions(
	ctx context.Context,
	auth PublicAPIAuthContext,
	request model.PublicAPIResponsesRequest,
	requestJSON json.RawMessage,
	includeUsage bool,
	emit func(eventName string, payload any) error,
) error {
	plan, err := s.prepareRun(ctx, auth, "chat_completions", request, requestJSON)
	if err != nil {
		return err
	}

	chunkID := "chatcmpl_" + strings.TrimPrefix(plan.ResponseID, "resp_")
	sentRole := false
	result, err := s.executeRun(ctx, plan, func(record publicAPIRuntimeEventRecord) error {
		textDelta := assistantDeltaFromRunEvents(record.RunEvents)
		if strings.TrimSpace(textDelta) == "" {
			return nil
		}

		delta := map[string]any{
			"content": textDelta,
		}
		if !sentRole {
			sentRole = true
			delta["role"] = "assistant"
		}

		return emit("", map[string]any{
			"id":      chunkID,
			"object":  "chat.completion.chunk",
			"created": plan.Invocation.CreatedAt.Unix(),
			"model":   plan.AgentName,
			"choices": []map[string]any{
				{
					"index":         0,
					"delta":         delta,
					"finish_reason": nil,
				},
			},
		})
	})
	if err != nil {
		return s.finishInvocationWithError(ctx, plan.Invocation, err, nil)
	}

	if !sentRole {
		if err := emit("", map[string]any{
			"id":      chunkID,
			"object":  "chat.completion.chunk",
			"created": plan.Invocation.CreatedAt.Unix(),
			"model":   plan.AgentName,
			"choices": []map[string]any{
				{
					"index": 0,
					"delta": map[string]any{"role": "assistant"},
				},
			},
		}); err != nil {
			return err
		}
	}

	if err := emit("", map[string]any{
		"id":      chunkID,
		"object":  "chat.completion.chunk",
		"created": plan.Invocation.CreatedAt.Unix(),
		"model":   plan.AgentName,
		"choices": []map[string]any{
			{
				"index":         0,
				"delta":         map[string]any{},
				"finish_reason": "stop",
			},
		},
	}); err != nil {
		return err
	}

	if includeUsage {
		responseObject := buildChatCompletionObject(
			plan.ResponseID,
			result.ResponseObject,
		)
		return emit("", map[string]any{
			"id":      chunkID,
			"object":  "chat.completion.chunk",
			"created": plan.Invocation.CreatedAt.Unix(),
			"model":   plan.AgentName,
			"choices": []map[string]any{},
			"usage":   responseObject["usage"],
		})
	}

	return nil
}

func (s *PublicAPIService) prepareRun(
	ctx context.Context,
	auth PublicAPIAuthContext,
	surface string,
	request model.PublicAPIResponsesRequest,
	requestJSON json.RawMessage,
) (*publicAPIRunPlan, error) {
	agentName := strings.ToLower(strings.TrimSpace(request.Model))
	if agentName == "" {
		return nil, &PublicAPIError{
			StatusCode: http.StatusBadRequest,
			Code:       "invalid_model",
			Message:    "model is required",
		}
	}
	if len(auth.AllowedAgents) > 0 && !containsNormalizedText(auth.AllowedAgents, agentName) {
		return nil, &PublicAPIError{
			StatusCode: http.StatusForbidden,
			Code:       "agent_not_allowed",
			Message:    "api token is not allowed to access this agent",
		}
	}

	reasoning, err := normalizeReasoningOptions(request.Reasoning)
	if err != nil {
		return nil, &PublicAPIError{
			StatusCode: http.StatusBadRequest,
			Code:       "invalid_reasoning",
			Message:    err.Error(),
		}
	}
	if err := validateMaxOutputTokens(request.MaxOutputTokens); err != nil {
		return nil, &PublicAPIError{
			StatusCode: http.StatusBadRequest,
			Code:       "invalid_max_output_tokens",
			Message:    err.Error(),
		}
	}

	agent, err := agentfs.LoadAgent(s.fs, agentName, "prod", false)
	if err != nil {
		return nil, err
	}
	if agent == nil || agent.Status != "prod" {
		return nil, &PublicAPIError{
			StatusCode: http.StatusNotFound,
			Code:       "model_not_found",
			Message:    "published agent not found",
		}
	}

	resolvedModelName, err := s.resolveModelName(ctx, agent)
	if err != nil {
		return nil, &PublicAPIError{
			StatusCode: http.StatusBadRequest,
			Code:       "invalid_agent_model",
			Message:    err.Error(),
		}
	}

	threadID, previousResponseID, err := s.resolveThreadID(ctx, request.PreviousResponseID, agentName, auth.APITokenID)
	if err != nil {
		return nil, err
	}

	metadata, err := normalizeJSONObject(request.Metadata)
	if err != nil {
		return nil, &PublicAPIError{
			StatusCode: http.StatusBadRequest,
			Code:       "invalid_metadata",
			Message:    err.Error(),
		}
	}

	normalizedInput, err := normalizeResponseInput(request.Input)
	if err != nil {
		return nil, &PublicAPIError{
			StatusCode: http.StatusBadRequest,
			Code:       "invalid_input",
			Message:    err.Error(),
		}
	}
	promptText, err := applyStructuredOutputContract(normalizedInput.PromptText, request.Text)
	if err != nil {
		return nil, &PublicAPIError{
			StatusCode: http.StatusBadRequest,
			Code:       "invalid_text_format",
			Message:    err.Error(),
		}
	}

	responseID := newPublicResponseID()
	now := time.Now().UTC()
	invocation := &model.PublicAPIInvocation{
		ID:           uuid.New(),
		ResponseID:   responseID,
		Surface:      surface,
		APITokenID:   auth.APITokenID,
		UserID:       auth.UserID,
		AgentName:    agentName,
		ThreadID:     threadID,
		RequestModel: agentName,
		Status:       "in_progress",
		RequestJSON:  requestJSON,
		ResponseJSON: json.RawMessage(`{}`),
		ClientIP:     auth.ClientIP,
		UserAgent:    auth.UserAgent,
		CreatedAt:    now,
	}
	if err := s.invocationRepo.Create(ctx, invocation); err != nil {
		return nil, err
	}

	if err := s.fs.EnsureThreadDirs(threadID); err != nil {
		return nil, s.finishInvocationWithError(ctx, invocation, wrapPublicAPITurnFailure(err, publicAPITurnFailureContext{
			TurnID:         responseID,
			Stage:          model.TurnFailureStagePrepareRun,
			PreviousTurnID: previousResponseID,
			Metadata:       metadata,
		}), nil)
	}
	if err := s.ensureLangGraphThread(ctx, auth.UserID, threadID); err != nil {
		return nil, s.finishInvocationWithError(ctx, invocation, wrapPublicAPITurnFailure(err, publicAPITurnFailureContext{
			TurnID:         responseID,
			Stage:          model.TurnFailureStagePrepareRun,
			PreviousTurnID: previousResponseID,
			Metadata:       metadata,
		}), nil)
	}

	runtimeUploads, err := s.stageInputFilesForThread(
		ctx,
		threadID,
		auth.APITokenID,
		normalizedInput.FileIDs,
	)
	if err != nil {
		return nil, s.finishInvocationWithError(ctx, invocation, wrapPublicAPITurnFailure(err, publicAPITurnFailureContext{
			TurnID:         responseID,
			Stage:          model.TurnFailureStagePrepareRun,
			PreviousTurnID: previousResponseID,
			Metadata:       metadata,
		}), nil)
	}

	return &publicAPIRunPlan{
		Auth:               auth,
		Surface:            surface,
		Request:            request,
		RequestJSON:        requestJSON,
		Invocation:         invocation,
		AgentName:          agentName,
		ModelName:          resolvedModelName,
		ThreadID:           threadID,
		ResponseID:         responseID,
		PreviousResponseID: previousResponseID,
		Metadata:           metadata,
		PromptText:         promptText,
		RuntimeUploads:     runtimeUploads,
		Reasoning:          reasoning,
		MaxOutputTokens:    request.MaxOutputTokens,
	}, nil
}

func (s *PublicAPIService) executeRun(
	ctx context.Context,
	plan *publicAPIRunPlan,
	onRuntimeEvent func(record publicAPIRuntimeEventRecord) error,
) (*publicAPIRunResult, error) {
	// Event index 1 is reserved for `run_started`, which is synthesized from the
	// invocation envelope before runtime stream events begin.
	collector := newPublicAPIRunCollector(1)
	if err := s.runAgentTurnStream(ctx, plan, func(sourceEvent string, payload any) error {
		record := collector.consume(sourceEvent, payload)
		if onRuntimeEvent == nil {
			return nil
		}
		return onRuntimeEvent(record)
	}); err != nil {
		return nil, err
	}

	if collector.hasQuestionRequest() && !collector.hasAssistantOutput() {
		return s.finishIncompleteRun(ctx, plan, collector.events)
	}

	statePayload, err := s.fetchThreadState(
		ctx,
		plan.Auth.UserID,
		plan.ThreadID,
		plan.AgentName,
		plan.ModelName,
	)
	if err != nil {
		return nil, err
	}

	outputText, reasoningText, artifactPaths, err := extractAssistantResultFromState(statePayload)
	if err != nil {
		return nil, err
	}
	outputText, err = normalizeStructuredOutputText(outputText, plan.Request.Text)
	if err != nil {
		return nil, err
	}

	if err := s.applyTraceUsage(ctx, plan); err != nil {
		return nil, err
	}

	responseArtifacts, ledgerArtifacts, err := s.buildResponseArtifacts(plan.Invocation, artifactPaths)
	if err != nil {
		return nil, err
	}
	if len(ledgerArtifacts) > 0 {
		if err := s.invocationRepo.AttachArtifacts(ctx, ledgerArtifacts); err != nil {
			return nil, err
		}
	}

	return s.finishCompletedRun(
		ctx,
		plan,
		outputText,
		reasoningText,
		responseArtifacts,
		buildResponseRunEvents(plan.Invocation, collector.events, outputText),
	)
}

func (s *PublicAPIService) applyTraceUsage(
	ctx context.Context,
	plan *publicAPIRunPlan,
) error {
	traceRecord, err := s.lookupLatestTrace(ctx, plan.ThreadID, plan.Auth.UserID)
	if err != nil {
		return err
	}
	if traceRecord == nil {
		return nil
	}

	plan.Invocation.TraceID = &traceRecord.TraceID
	plan.Invocation.InputTokens = traceRecord.InputTokens
	plan.Invocation.OutputTokens = traceRecord.OutputTokens
	plan.Invocation.TotalTokens = traceRecord.TotalTokens
	return nil
}

func (s *PublicAPIService) finishIncompleteRun(
	ctx context.Context,
	plan *publicAPIRunPlan,
	runtimeEvents []model.PublicAPIRunEvent,
) (*publicAPIRunResult, error) {
	if err := s.applyTraceUsage(ctx, plan); err != nil {
		return nil, err
	}

	plan.Invocation.Status = "incomplete"
	finishedAt := time.Now().UTC()
	plan.Invocation.FinishedAt = &finishedAt
	responseObject := buildResponseEnvelope(
		plan.Invocation,
		"",
		"",
		[]model.PublicAPIResponseArtifact{},
		plan.Metadata,
		plan.PreviousResponseID,
		buildInterruptedRunEvents(plan.Invocation, runtimeEvents),
		plan.Reasoning,
	)
	responseBody, err := json.Marshal(responseObject)
	if err != nil {
		return nil, err
	}
	plan.Invocation.ResponseJSON = responseBody
	if err := s.invocationRepo.Finish(ctx, plan.Invocation); err != nil {
		return nil, err
	}

	return &publicAPIRunResult{
		Body:           responseBody,
		OutputText:     "",
		ReasoningText:  "",
		ResponseObject: responseObject,
		Incomplete:     true,
	}, nil
}

func (s *PublicAPIService) finishCompletedRun(
	ctx context.Context,
	plan *publicAPIRunPlan,
	outputText string,
	reasoningText string,
	responseArtifacts []model.PublicAPIResponseArtifact,
	runEvents []model.PublicAPIRunEvent,
) (*publicAPIRunResult, error) {
	plan.Invocation.Status = "completed"
	finishedAt := time.Now().UTC()
	plan.Invocation.FinishedAt = &finishedAt
	responseObject := buildResponseEnvelope(
		plan.Invocation,
		outputText,
		reasoningText,
		responseArtifacts,
		plan.Metadata,
		plan.PreviousResponseID,
		runEvents,
		plan.Reasoning,
	)
	responseBody, err := json.Marshal(responseObject)
	if err != nil {
		return nil, err
	}
	plan.Invocation.ResponseJSON = responseBody
	if err := s.invocationRepo.Finish(ctx, plan.Invocation); err != nil {
		return nil, err
	}

	return &publicAPIRunResult{
		Body:           responseBody,
		OutputText:     outputText,
		ReasoningText:  reasoningText,
		ResponseObject: responseObject,
		Incomplete:     false,
	}, nil
}

func newPublicAPIRunCollector(startIndex int) *publicAPIRunCollector {
	return &publicAPIRunCollector{
		events:                make([]model.PublicAPIRunEvent, 0, 16),
		sequence:              startIndex,
		activeToolPhaseCounts: make(map[string]int),
		activeToolCallKeys:    make(map[string]int),
		pendingToolCallKeys:   make(map[string]pendingPublicAPIToolCall),
		startedToolCallKeys:   make(map[string]struct{}),
	}
}

func (c *publicAPIRunCollector) hasQuestionRequest() bool {
	for index := len(c.events) - 1; index >= 0; index-- {
		if c.events[index].Type == model.PublicAPIQuestionRequested {
			return true
		}
	}
	return false
}

func (c *publicAPIRunCollector) hasAssistantOutput() bool {
	for _, event := range c.events {
		if event.Type == model.PublicAPIAssistantDelta || event.Type == model.PublicAPIAssistantMessage {
			return true
		}
	}
	return false
}

func (c *publicAPIRunCollector) consume(sourceEvent string, payload any) publicAPIRuntimeEventRecord {
	events := make([]model.PublicAPIRunEvent, 0, 2)
	switch sourceEvent {
	case "messages", "messages-tuple":
		record := extractStreamMessageRecord(payload)
		messageType := strings.ToLower(strings.TrimSpace(fmt.Sprint(record["type"])))
		switch {
		case strings.HasPrefix(messageType, "ai"):
			if toolEvents := c.extractToolCallEventsFromMessage(record); len(toolEvents) > 0 {
				events = append(events, toolEvents...)
			}
			if textDelta := extractMessageChunkTextDelta(record["content"]); strings.TrimSpace(textDelta) != "" {
				events = append(events, c.pushEvent(model.PublicAPIRunEvent{
					Type:  model.PublicAPIAssistantDelta,
					Delta: textDelta,
				}))
			}
		case messageType == "tool":
			if pendingStart := c.flushPendingToolCallFromResult(record); pendingStart != nil {
				events = append(events, *pendingStart)
			}
			if toolEvent := c.extractToolResultEventFromMessage(record); toolEvent != nil {
				events = append(events, *toolEvent)
			}
		}
	case "values":
		if toolEvents := c.extractToolCallEventsFromValues(payload); len(toolEvents) > 0 {
			events = append(events, toolEvents...)
		}
	case "custom":
		record, ok := payload.(map[string]any)
		if ok {
			events = append(events, c.extractRuntimeCustomEvents(record)...)
		}
	case "updates":
		record, ok := payload.(map[string]any)
		if ok {
			events = append(events, c.extractInterruptEvents(record)...)
		}
	}
	return publicAPIRuntimeEventRecord{
		RunEvents: events,
	}
}

func (c *publicAPIRunCollector) extractRuntimeCustomEvents(payload map[string]any) []model.PublicAPIRunEvent {
	if strings.TrimSpace(fmt.Sprint(payload["type"])) != "execution_event" {
		return nil
	}

	eventName := strings.TrimSpace(fmt.Sprint(payload["event"]))
	phaseKind := strings.TrimSpace(fmt.Sprint(payload["phase_kind"]))
	toolName := strings.TrimSpace(fmt.Sprint(payload["tool_name"]))

	// Public `/v1/responses` already synthesizes `run_started` from the response
	// envelope, so custom runtime events should only add canonical details that
	// the gateway cannot derive safely from the northbound transport alone.
	switch {
	case eventName == "phase_started" && phaseKind == "tool":
		c.activeToolPhaseCounts[toolName] = c.activeToolPhaseCounts[toolName] + 1
		return nil
	case eventName == "phase_finished" && phaseKind == "tool":
		if c.activeToolPhaseCounts[toolName] <= 0 {
			// Some runtime paths can currently emit a duplicate terminal tool phase
			// after the first completion. Drop unmatched finishes here so the
			// canonical public run-event ledger preserves one start/finish pair per
			// observed tool phase until the runtime-side source is narrowed further.
			return nil
		}
		c.activeToolPhaseCounts[toolName]--
		return nil
	default:
		return nil
	}
}

func (c *publicAPIRunCollector) extractToolCallEventsFromMessage(record map[string]any) []model.PublicAPIRunEvent {
	rawCalls, ok := record["tool_calls"].([]any)
	if !ok || len(rawCalls) == 0 {
		return nil
	}

	events := make([]model.PublicAPIRunEvent, 0, len(rawCalls))
	for index, rawCall := range rawCalls {
		call, ok := rawCall.(map[string]any)
		if !ok {
			continue
		}
		toolName := strings.TrimSpace(fmt.Sprint(call["name"]))
		if toolName == "" {
			continue
		}
		toolKey := strings.TrimSpace(fmt.Sprint(firstNonNil(call["id"], fmt.Sprintf("%s:%d", toolName, index))))
		if toolKey != "" {
			if _, ok := c.startedToolCallKeys[toolKey]; ok {
				continue
			}
			if c.activeToolCallKeys[toolKey] > 0 {
				continue
			}
		}
		toolArgs := firstNonNil(call["args"], call["arguments"])
		if isEmptyStructuredValue(toolArgs) {
			// Some LangGraph message chunks expose the real tool payload only in
			// Anthropic-style `tool_use` content blocks (`partial_json` / `input`)
			// while the top-level `tool_calls[].args` placeholder remains `{}`.
			// Recover the public SDK-facing arguments from that richer block so the
			// customer timeline shows the actual MCP call parameters.
			toolArgs = extractToolArgsFromContent(record["content"], toolName, toolKey)
		}
		if isEmptyStructuredValue(toolArgs) {
			// The chunk-level tool-call placeholder often arrives before the richer
			// `values` snapshot that contains parsed arguments. Defer emission until
			// that snapshot lands so streaming clients see real parameters instead
			// of `{}`. If no richer snapshot appears, the pending start is flushed
			// right before the matching tool result.
			c.pendingToolCallKeys[toolKey] = pendingPublicAPIToolCall{
				ToolName: toolName,
				ToolArgs: toolArgs,
			}
			continue
		}
		if toolKey != "" {
			delete(c.pendingToolCallKeys, toolKey)
			c.startedToolCallKeys[toolKey] = struct{}{}
		}
		c.activeToolCallKeys[toolKey] = 1
		events = append(events, c.pushEvent(model.PublicAPIRunEvent{
			Type:     model.PublicAPIToolStarted,
			ToolName: toolName,
			ToolArgs: toolArgs,
		}))
	}
	return events
}

func (c *publicAPIRunCollector) extractToolResultEventFromMessage(record map[string]any) *model.PublicAPIRunEvent {
	toolName := strings.TrimSpace(fmt.Sprint(record["name"]))
	if toolName == "" {
		return nil
	}

	toolKey := strings.TrimSpace(fmt.Sprint(firstNonNil(record["tool_call_id"], record["id"], toolName)))
	if toolKey != "" {
		if c.activeToolCallKeys[toolKey] <= 0 {
			// The message stream can repeat tool-result snapshots. Preserve one
			// public finish event per tool call so the customer-facing timeline
			// stays stable across stream replays and final response hydration.
			return nil
		}
		c.activeToolCallKeys[toolKey]--
	}

	event := c.pushEvent(model.PublicAPIRunEvent{
		Type:       model.PublicAPIToolFinished,
		ToolName:   toolName,
		ToolOutput: record["content"],
	})
	return &event
}

func (c *publicAPIRunCollector) extractToolCallEventsFromValues(payload any) []model.PublicAPIRunEvent {
	values, ok := extractStreamValues(payload)
	if !ok {
		return nil
	}
	messages, ok := values["messages"].([]any)
	if !ok || len(messages) == 0 {
		return nil
	}

	events := make([]model.PublicAPIRunEvent, 0, 2)
	for _, rawMessage := range messages {
		record, ok := rawMessage.(map[string]any)
		if !ok {
			continue
		}
		messageType := strings.ToLower(strings.TrimSpace(fmt.Sprint(record["type"])))
		if strings.HasPrefix(messageType, "ai") {
			events = append(events, c.extractToolCallEventsFromMessage(record)...)
		}
	}
	return events
}

func (c *publicAPIRunCollector) flushPendingToolCallFromResult(record map[string]any) *model.PublicAPIRunEvent {
	toolName := strings.TrimSpace(fmt.Sprint(record["name"]))
	if toolName == "" {
		return nil
	}
	toolKey := strings.TrimSpace(fmt.Sprint(firstNonNil(record["tool_call_id"], record["id"], toolName)))
	if toolKey == "" {
		return nil
	}

	pending, ok := c.pendingToolCallKeys[toolKey]
	if !ok {
		return nil
	}
	delete(c.pendingToolCallKeys, toolKey)
	c.startedToolCallKeys[toolKey] = struct{}{}
	c.activeToolCallKeys[toolKey] = 1
	event := c.pushEvent(model.PublicAPIRunEvent{
		Type:     model.PublicAPIToolStarted,
		ToolName: pending.ToolName,
		ToolArgs: pending.ToolArgs,
	})
	return &event
}

func (c *publicAPIRunCollector) extractInterruptEvents(payload map[string]any) []model.PublicAPIRunEvent {
	interrupts, ok := payload["__interrupt__"].([]any)
	if !ok || len(interrupts) == 0 {
		return nil
	}

	events := make([]model.PublicAPIRunEvent, 0, len(interrupts))
	for index, rawInterrupt := range interrupts {
		questionID := fmt.Sprintf("interrupt:%d", index)
		interrupt, ok := rawInterrupt.(map[string]any)
		if ok {
			value, _ := interrupt["value"].(map[string]any)
			if value != nil {
				if requestID := strings.TrimSpace(fmt.Sprint(firstNonNil(value["request_id"], value["requestId"]))); requestID != "" {
					questionID = requestID
				}
			}
		}
		events = append(events, c.pushEvent(model.PublicAPIRunEvent{
			Type:       model.PublicAPIQuestionRequested,
			QuestionID: questionID,
		}))
	}
	return events
}

func (c *publicAPIRunCollector) pushEvent(event model.PublicAPIRunEvent) model.PublicAPIRunEvent {
	c.sequence++
	event.EventIndex = c.sequence
	event.CreatedAt = time.Now().UTC().Unix()
	c.events = append(c.events, event)
	return event
}

func (s *PublicAPIService) GetResponse(
	ctx context.Context,
	responseID string,
	apiTokenID uuid.UUID,
) (json.RawMessage, error) {
	invocation, err := s.invocationRepo.GetByResponseID(ctx, strings.TrimSpace(responseID), apiTokenID)
	if err != nil {
		return nil, err
	}
	if invocation == nil {
		return nil, &PublicAPIError{
			StatusCode: http.StatusNotFound,
			Code:       "response_not_found",
			Message:    "response not found",
		}
	}
	return invocation.ResponseJSON, nil
}

func (s *PublicAPIService) GetFile(
	ctx context.Context,
	fileID string,
	apiTokenID uuid.UUID,
) (*model.PublicAPIFileObject, error) {
	trimmedFileID := strings.TrimSpace(fileID)
	if trimmedFileID == "" {
		return nil, &PublicAPIError{
			StatusCode: http.StatusNotFound,
			Code:       "file_not_found",
			Message:    "file not found",
		}
	}

	if s.inputFileRepo != nil {
		inputFile, err := s.inputFileRepo.GetByFileID(ctx, trimmedFileID, apiTokenID)
		if err != nil {
			return nil, err
		}
		if inputFile != nil {
			return buildPublicAPIFileObject(inputFile), nil
		}
	}

	artifact, _, err := s.invocationRepo.GetArtifactByFileID(ctx, trimmedFileID, apiTokenID)
	if err != nil {
		return nil, err
	}
	if artifact == nil {
		return nil, &PublicAPIError{
			StatusCode: http.StatusNotFound,
			Code:       "file_not_found",
			Message:    "file not found",
		}
	}

	return &model.PublicAPIFileObject{
		ID:        artifact.FileID,
		Object:    "file",
		Bytes:     derefInt64(artifact.SizeBytes),
		CreatedAt: artifact.CreatedAt.Unix(),
		Filename:  path.Base(artifact.VirtualPath),
		Purpose:   "output",
		MimeType:  artifact.MimeType,
		Status:    "processed",
	}, nil
}

func (s *PublicAPIService) GetFileContent(
	ctx context.Context,
	fileID string,
	apiTokenID uuid.UUID,
) (*PublicAPIFileResult, error) {
	trimmedFileID := strings.TrimSpace(fileID)
	if s.inputFileRepo != nil {
		inputFile, err := s.inputFileRepo.GetByFileID(ctx, trimmedFileID, apiTokenID)
		if err != nil {
			return nil, err
		}
		if inputFile != nil {
			filePath, err := s.resolveBaseStoragePath(inputFile.StorageRef)
			if err != nil {
				if errors.Is(err, errArtifactNotFound) {
					return nil, &PublicAPIError{
						StatusCode: http.StatusNotFound,
						Code:       "file_not_found",
						Message:    "file not found",
					}
				}
				return nil, err
			}

			body, err := os.ReadFile(filePath)
			if err != nil {
				if os.IsNotExist(err) {
					return nil, &PublicAPIError{
						StatusCode: http.StatusNotFound,
						Code:       "file_not_found",
						Message:    "file not found",
					}
				}
				return nil, err
			}

			contentType := "application/octet-stream"
			if inputFile.MimeType != nil && strings.TrimSpace(*inputFile.MimeType) != "" {
				contentType = strings.TrimSpace(*inputFile.MimeType)
			}
			return &PublicAPIFileResult{
				Body:        body,
				ContentType: contentType,
				Filename:    inputFile.Filename,
			}, nil
		}
	}

	artifact, invocation, err := s.invocationRepo.GetArtifactByFileID(ctx, strings.TrimSpace(fileID), apiTokenID)
	if err != nil {
		return nil, err
	}
	if artifact == nil || invocation == nil {
		return nil, &PublicAPIError{
			StatusCode: http.StatusNotFound,
			Code:       "file_not_found",
			Message:    "file not found",
		}
	}

	filePath, err := s.resolveArtifactStoragePath(invocation.ThreadID, artifact.StorageRef)
	if err != nil {
		if errors.Is(err, errArtifactNotFound) {
			return nil, &PublicAPIError{
				StatusCode: http.StatusNotFound,
				Code:       "file_not_found",
				Message:    "file not found",
			}
		}
		return nil, err
	}

	body, err := os.ReadFile(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, &PublicAPIError{
				StatusCode: http.StatusNotFound,
				Code:       "file_not_found",
				Message:    "file not found",
			}
		}
		return nil, err
	}

	contentType := "application/octet-stream"
	if artifact.MimeType != nil && strings.TrimSpace(*artifact.MimeType) != "" {
		contentType = strings.TrimSpace(*artifact.MimeType)
	}

	return &PublicAPIFileResult{
		Body:        body,
		ContentType: contentType,
		Filename:    path.Base(artifact.VirtualPath),
	}, nil
}

func (s *PublicAPIService) ListInvocations(
	ctx context.Context,
	userID uuid.UUID,
	filter model.PublicAPIInvocationFilter,
) ([]model.PublicAPIInvocation, error) {
	return s.invocationRepo.ListByUser(ctx, userID, filter)
}

func (s *PublicAPIService) resolveModelName(ctx context.Context, agent *model.Agent) (string, error) {
	if agent.Model == nil || strings.TrimSpace(*agent.Model) == "" {
		return "", fmt.Errorf("agent has no model configured; fallback selection is disabled")
	}

	row, err := s.modelRepo.FindEnabledByName(ctx, strings.TrimSpace(*agent.Model))
	if err != nil {
		return "", fmt.Errorf("failed to load model %q: %w", *agent.Model, err)
	}
	if row == nil {
		return "", fmt.Errorf("agent model %q not found or disabled", *agent.Model)
	}
	return row.Name, nil
}

func (s *PublicAPIService) resolveThreadID(
	ctx context.Context,
	previousResponseID string,
	agentName string,
	apiTokenID uuid.UUID,
) (string, string, error) {
	trimmedPrevious := strings.TrimSpace(previousResponseID)
	if trimmedPrevious == "" {
		return uuid.NewString(), "", nil
	}

	invocation, err := s.invocationRepo.GetByResponseID(ctx, trimmedPrevious, apiTokenID)
	if err != nil {
		return "", "", err
	}
	if invocation == nil {
		return "", "", &PublicAPIError{
			StatusCode: http.StatusNotFound,
			Code:       "previous_response_not_found",
			Message:    "previous_response_id was not found for this api token",
		}
	}
	if invocation.AgentName != agentName {
		return "", "", &PublicAPIError{
			StatusCode: http.StatusBadRequest,
			Code:       "model_mismatch",
			Message:    "previous_response_id belongs to a different model",
		}
	}
	return invocation.ThreadID, invocation.ResponseID, nil
}

func (s *PublicAPIService) ensureLangGraphThread(ctx context.Context, userID uuid.UUID, threadID string) error {
	bodyBytes, err := json.Marshal(map[string]any{
		"thread_id": threadID,
		"if_exists": "do_nothing",
		"metadata": map[string]any{
			"graph_id": publicAPIAssistantID,
		},
	})
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		s.langGraphURL+"/threads",
		bytes.NewReader(bodyBytes),
	)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-User-ID", userID.String())

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= http.StatusOK && resp.StatusCode < http.StatusMultipleChoices {
		return nil
	}

	body, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
	return fmt.Errorf("langgraph thread create failed: status %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
}

func (s *PublicAPIService) runAgentTurnStream(
	ctx context.Context,
	plan *publicAPIRunPlan,
	onEvent func(sourceEvent string, payload any) error,
) error {
	message := map[string]any{
		"type": "human",
		"content": []map[string]any{
			{
				"type": "text",
				"text": plan.PromptText,
			},
		},
	}
	if len(plan.RuntimeUploads) > 0 {
		files := make([]map[string]any, 0, len(plan.RuntimeUploads))
		for _, file := range plan.RuntimeUploads {
			payload := map[string]any{
				"filename": file.Filename,
				"size":     file.Size,
			}
			if strings.TrimSpace(file.MarkdownFile) != "" {
				payload["markdown_file"] = file.MarkdownFile
				payload["markdown_virtual_path"] = "/mnt/user-data/uploads/" + file.MarkdownFile
			}
			files = append(files, payload)
		}
		// Public API uploads are staged into the thread uploads directory before
		// the run starts so the runtime sees the exact same additional_kwargs.files
		// contract as the first-party workspace uploader.
		message["additional_kwargs"] = map[string]any{"files": files}
	}

	requestPayload := map[string]any{
		"assistant_id": publicAPIAssistantID,
		"input": map[string]any{
			"messages": []map[string]any{message},
		},
		"config": map[string]any{
			"configurable": map[string]any{
				"agent_name":   plan.AgentName,
				"agent_status": "prod",
				"thread_id":    plan.ThreadID,
				"model_name":   plan.ModelName,
				// Public `/v1` defaults to non-thinking unless the caller requests
				// reasoning explicitly. This keeps the external contract predictable
				// instead of inheriting workspace-local defaults.
				"thinking_enabled": plan.Reasoning.ThinkingEnabled,
			},
		},
		// Request `updates` alongside `custom` so runtime question/interrupt
		// signals can enter the same canonical run-event collector instead of
		// forcing the gateway to infer question state from snapshots later.
		"stream_mode": []string{"values", "messages-tuple", "custom", "updates"},
	}
	configurableMap := requestPayload["config"].(map[string]any)["configurable"].(map[string]any)
	if strings.TrimSpace(plan.Reasoning.Effort) != "" {
		configurableMap["effort"] = plan.Reasoning.Effort
	}
	if plan.MaxOutputTokens != nil {
		configurableMap["max_output_tokens"] = *plan.MaxOutputTokens
	}
	bodyBytes, err := json.Marshal(requestPayload)
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		s.langGraphURL+"/threads/"+url.PathEscape(plan.ThreadID)+"/runs/stream",
		bytes.NewReader(bodyBytes),
	)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	applyLangGraphRuntimeHeaders(req, plan.Auth.UserID, plan.AgentName, plan.ModelName)

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		body, readErr := io.ReadAll(io.LimitReader(resp.Body, 4096))
		if readErr != nil {
			return readErr
		}
		return fmt.Errorf("langgraph run failed: status %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	if !strings.Contains(strings.ToLower(resp.Header.Get("Content-Type")), "text/event-stream") {
		body, err := io.ReadAll(io.LimitReader(resp.Body, 4096))
		if err != nil {
			return err
		}
		if runErr := extractLangGraphRunError(body); runErr != "" {
			return fmt.Errorf("langgraph run failed: %s", runErr)
		}
		return fmt.Errorf("langgraph stream returned non-SSE payload")
	}

	return readSSEStream(resp.Body, func(sourceEvent string, payload []byte) error {
		if sourceEvent == "" {
			sourceEvent = "message"
		}
		trimmed := bytes.TrimSpace(payload)
		if sourceEvent == "end" {
			if onEvent != nil {
				return onEvent("end", map[string]any{})
			}
			return nil
		}
		if len(trimmed) == 0 {
			if onEvent != nil {
				return onEvent(sourceEvent, map[string]any{})
			}
			return nil
		}

		var decoded any
		if err := json.Unmarshal(trimmed, &decoded); err != nil {
			if sourceEvent == "error" {
				return fmt.Errorf("langgraph stream error: %s", strings.TrimSpace(string(trimmed)))
			}
			return err
		}
		if sourceEvent == "error" {
			return fmt.Errorf("langgraph stream error: %s", strings.TrimSpace(string(trimmed)))
		}
		if onEvent != nil {
			return onEvent(sourceEvent, decoded)
		}
		return nil
	})
}

func (s *PublicAPIService) fetchThreadState(
	ctx context.Context,
	userID uuid.UUID,
	threadID string,
	agentName string,
	modelName string,
) ([]byte, error) {
	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodGet,
		s.langGraphURL+"/threads/"+url.PathEscape(threadID)+"/state",
		nil,
	)
	if err != nil {
		return nil, err
	}
	// Thread-scoped state reads happen immediately after the first run in this
	// public API flow. Keep the runtime identity on the request so LangGraph does
	// not depend on a separately persisted thread binding already existing.
	applyLangGraphRuntimeHeaders(req, userID, agentName, modelName)

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= http.StatusOK && resp.StatusCode < http.StatusMultipleChoices {
		if hasStateValues(body) {
			return body, nil
		}
		return s.fetchThreadHistory(ctx, userID, threadID, agentName, modelName)
	}
	return nil, fmt.Errorf("langgraph state fetch failed: status %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
}

func (s *PublicAPIService) fetchThreadHistory(
	ctx context.Context,
	userID uuid.UUID,
	threadID string,
	agentName string,
	modelName string,
) ([]byte, error) {
	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		s.langGraphURL+"/threads/"+url.PathEscape(threadID)+"/history",
		bytes.NewReader([]byte(`{}`)),
	)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	applyLangGraphRuntimeHeaders(req, userID, agentName, modelName)

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= http.StatusOK && resp.StatusCode < http.StatusMultipleChoices {
		return body, nil
	}
	return nil, fmt.Errorf("langgraph history fetch failed: status %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
}

func applyLangGraphRuntimeHeaders(
	req *http.Request,
	userID uuid.UUID,
	agentName string,
	modelName string,
) {
	req.Header.Set("X-User-ID", userID.String())
	if trimmedAgentName := strings.TrimSpace(agentName); trimmedAgentName != "" {
		req.Header.Set("X-Agent-Name", trimmedAgentName)
		req.Header.Set("X-Agent-Status", "prod")
	}
	if trimmedModelName := strings.TrimSpace(modelName); trimmedModelName != "" {
		req.Header.Set("X-Model-Name", trimmedModelName)
	}
}

func (s *PublicAPIService) lookupLatestTrace(
	ctx context.Context,
	threadID string,
	userID uuid.UUID,
) (*repository.AgentTraceRecord, error) {
	if s.traceRepo == nil {
		return nil, nil
	}
	return s.traceRepo.FindLatestByThreadAndUser(ctx, threadID, userID)
}

func (s *PublicAPIService) buildResponseArtifacts(
	invocation *model.PublicAPIInvocation,
	artifactPaths []string,
) ([]model.PublicAPIResponseArtifact, []model.PublicAPIArtifact, error) {
	// Public API callers should see the same persisted output files that the
	// first-party workspace can discover, even when the model wrote into
	// `/mnt/user-data/outputs` but forgot to call `present_files`.
	discoveredOutputs, err := threadartifacts.ListOutputArtifacts(s.fs, invocation.ThreadID)
	if err != nil {
		return nil, nil, err
	}
	artifactPaths = dedupeStrings(append(artifactPaths, discoveredOutputs...))
	if len(artifactPaths) == 0 {
		return []model.PublicAPIResponseArtifact{}, []model.PublicAPIArtifact{}, nil
	}

	seen := make(map[string]struct{}, len(artifactPaths))
	responseArtifacts := make([]model.PublicAPIResponseArtifact, 0, len(artifactPaths))
	ledgerArtifacts := make([]model.PublicAPIArtifact, 0, len(artifactPaths))
	for _, artifactPath := range artifactPaths {
		virtualPath := strings.TrimSpace(artifactPath)
		if virtualPath == "" {
			continue
		}
		if _, exists := seen[virtualPath]; exists {
			continue
		}
		seen[virtualPath] = struct{}{}

		storageRef, filePath, err := s.resolveStorageRef(invocation.ThreadID, virtualPath)
		if err != nil {
			continue
		}

		info, err := os.Stat(filePath)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return nil, nil, err
		}

		fileID := newPublicFileID()
		mimeType := guessMimeType(filePath)
		sizeBytes := info.Size()
		ledgerArtifact := model.PublicAPIArtifact{
			ID:           uuid.New(),
			InvocationID: invocation.ID,
			ResponseID:   invocation.ResponseID,
			FileID:       fileID,
			VirtualPath:  virtualPath,
			StorageRef:   storageRef,
			MimeType:     &mimeType,
			SizeBytes:    &sizeBytes,
			CreatedAt:    time.Now().UTC(),
		}
		ledgerArtifacts = append(ledgerArtifacts, ledgerArtifact)
		responseArtifacts = append(responseArtifacts, model.PublicAPIResponseArtifact{
			ID:          fileID,
			Object:      "file",
			Filename:    path.Base(virtualPath),
			MimeType:    &mimeType,
			Bytes:       &sizeBytes,
			DownloadURL: "/v1/files/" + url.PathEscape(fileID) + "/content",
		})
	}
	return responseArtifacts, ledgerArtifacts, nil
}

func (s *PublicAPIService) resolveStorageRef(threadID string, virtualPath string) (string, string, error) {
	cleaned := path.Clean(strings.TrimSpace(virtualPath))
	switch {
	case strings.HasPrefix(cleaned, "/mnt/user-data/outputs/"):
		relative := strings.TrimPrefix(cleaned, "/mnt/user-data/outputs/")
		storageRef := path.Join("outputs", relative)
		filePath, err := s.resolveArtifactStoragePath(threadID, storageRef)
		return storageRef, filePath, err
	case strings.HasPrefix(cleaned, "mnt/user-data/outputs/"):
		relative := strings.TrimPrefix(cleaned, "mnt/user-data/outputs/")
		storageRef := path.Join("outputs", relative)
		filePath, err := s.resolveArtifactStoragePath(threadID, storageRef)
		return storageRef, filePath, err
	default:
		return "", "", errArtifactNotFound
	}
}

func (s *PublicAPIService) resolveArtifactStoragePath(threadID string, storageRef string) (string, error) {
	baseDir := filepath.Clean(s.fs.ThreadUserDataDir(threadID))
	cleanRelative := filepath.Clean(filepath.FromSlash(strings.TrimPrefix(storageRef, "/")))
	if cleanRelative == "." || cleanRelative == "" {
		return "", errArtifactNotFound
	}

	filePath := filepath.Join(baseDir, cleanRelative)
	relative, err := filepath.Rel(baseDir, filePath)
	if err != nil {
		return "", err
	}
	if relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("artifact storage_ref escapes thread user-data")
	}
	if _, err := os.Stat(filePath); err != nil {
		if os.IsNotExist(err) {
			return "", errArtifactNotFound
		}
		return "", err
	}
	return filePath, nil
}

func (s *PublicAPIService) resolveBaseStoragePath(storageRef string) (string, error) {
	baseDir := filepath.Clean(s.fs.BaseDir())
	cleanRelative := filepath.Clean(filepath.FromSlash(strings.TrimPrefix(storageRef, "/")))
	if cleanRelative == "." || cleanRelative == "" {
		return "", errArtifactNotFound
	}

	filePath := filepath.Join(baseDir, cleanRelative)
	relative, err := filepath.Rel(baseDir, filePath)
	if err != nil {
		return "", err
	}
	if relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("storage_ref escapes gateway base dir")
	}
	return filePath, nil
}

func (s *PublicAPIService) stageInputFilesForThread(
	ctx context.Context,
	threadID string,
	apiTokenID uuid.UUID,
	fileIDs []string,
) ([]publicAPIRuntimeUpload, error) {
	if len(fileIDs) == 0 {
		return []publicAPIRuntimeUpload{}, nil
	}
	if s.inputFileRepo == nil {
		return nil, &PublicAPIError{
			StatusCode: http.StatusInternalServerError,
			Code:       "upload_unavailable",
			Message:    "public file uploads are not configured",
		}
	}

	uploadsDir := filepath.Join(s.fs.ThreadUserDataDir(threadID), "uploads")
	if err := os.MkdirAll(uploadsDir, 0o755); err != nil {
		return nil, err
	}

	seen := make(map[string]struct{}, len(fileIDs))
	staged := make([]publicAPIRuntimeUpload, 0, len(fileIDs))
	for _, rawFileID := range fileIDs {
		fileID := strings.TrimSpace(rawFileID)
		if fileID == "" {
			continue
		}
		if _, exists := seen[fileID]; exists {
			continue
		}
		seen[fileID] = struct{}{}

		// Input files are token-scoped so one enterprise integration key cannot
		// silently attach another key's private uploads on a later response call.
		inputFile, err := s.inputFileRepo.GetByFileID(ctx, fileID, apiTokenID)
		if err != nil {
			return nil, err
		}
		if inputFile == nil {
			return nil, &PublicAPIError{
				StatusCode: http.StatusNotFound,
				Code:       "file_not_found",
				Message:    "input file was not found for this api token",
			}
		}

		sourcePath, err := s.resolveBaseStoragePath(inputFile.StorageRef)
		if err != nil {
			return nil, err
		}
		targetFilename := buildPublicAPIThreadUploadName(inputFile.FileID, inputFile.Filename)
		targetPath := filepath.Join(uploadsDir, targetFilename)
		if err := copyFile(sourcePath, targetPath); err != nil {
			return nil, err
		}

		markdownFile := ""
		if uploadutil.IsMarkdownConvertible(targetFilename) {
			markdownPath, convertErr := uploadutil.ConvertFileToMarkdown(targetPath)
			if convertErr != nil {
				log.Printf("public_api: failed to convert %s to markdown: %v", targetFilename, convertErr)
			} else {
				markdownFile = filepath.Base(markdownPath)
			}
		}

		staged = append(staged, publicAPIRuntimeUpload{
			Filename:     targetFilename,
			Size:         inputFile.SizeBytes,
			MarkdownFile: markdownFile,
		})
	}

	return staged, nil
}

func (s *PublicAPIService) finishInvocationWithError(
	ctx context.Context,
	invocation *model.PublicAPIInvocation,
	cause error,
	runEvents []model.PublicAPIRunEvent,
) error {
	invocation.Status = "failed"
	message := strings.TrimSpace(cause.Error())
	if message == "" {
		message = "public api invocation failed"
	}
	invocation.Error = &message
	finishedAt := time.Now().UTC()
	invocation.FinishedAt = &finishedAt
	if invocation != nil && invocation.Surface == "turns" {
		invocation.ResponseJSON = buildFailedTurnSnapshotEnvelope(invocation, message, cause)
	} else {
		invocation.ResponseJSON = buildFailedResponseEnvelope(invocation, message, runEvents)
	}
	if err := s.invocationRepo.Finish(ctx, invocation); err != nil {
		return err
	}
	if context, ok := extractPublicAPITurnFailureContext(cause); ok {
		var publicErr *PublicAPIError
		if errors.As(cause, &publicErr) && publicErr != nil {
			return wrapPublicAPITurnFailure(publicErr, context)
		}
		return wrapPublicAPITurnFailure(&PublicAPIError{
			StatusCode: http.StatusBadGateway,
			Code:       "runtime_error",
			Message:    message,
		}, context)
	}
	var publicErr *PublicAPIError
	if errors.As(cause, &publicErr) && publicErr != nil {
		return publicErr
	}
	return &PublicAPIError{
		StatusCode: http.StatusBadGateway,
		Code:       "runtime_error",
		Message:    message,
	}
}

func buildFailedResponseEnvelope(
	invocation *model.PublicAPIInvocation,
	message string,
	runEvents []model.PublicAPIRunEvent,
) json.RawMessage {
	if invocation == nil {
		return json.RawMessage(`{}`)
	}
	if len(runEvents) == 0 {
		runEvents = []model.PublicAPIRunEvent{
			{
				EventIndex: 1,
				CreatedAt:  time.Now().UTC().Unix(),
				Type:       model.PublicAPIRunFailed,
				ResponseID: invocation.ResponseID,
				Error:      message,
			},
		}
	}
	payload := map[string]any{
		"id":           invocation.ResponseID,
		"object":       "response",
		"created_at":   invocation.CreatedAt.Unix(),
		"completed_at": invocation.FinishedAt.Unix(),
		"status":       invocation.Status,
		"model":        invocation.RequestModel,
		"output_text":  "",
		"usage": map[string]any{
			"input_tokens":  invocation.InputTokens,
			"output_tokens": invocation.OutputTokens,
			"total_tokens":  invocation.TotalTokens,
		},
		"artifacts": []any{},
		"openagents": map[string]any{
			"thread_id":  invocation.ThreadID,
			"run_events": runEvents,
		},
	}
	if invocation.TraceID != nil && strings.TrimSpace(*invocation.TraceID) != "" {
		payload["openagents"].(map[string]any)["trace_id"] = strings.TrimSpace(*invocation.TraceID)
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return json.RawMessage(`{}`)
	}
	return encoded
}

func (s *PublicAPIService) lookupAgentCreatedAt(agentName string) int64 {
	info, err := os.Stat(filepath.Join(s.fs.AgentDir(agentName, "prod"), "config.yaml"))
	if err != nil {
		return 0
	}
	return info.ModTime().Unix()
}

func newPublicResponseID() string {
	return "resp_" + strings.ReplaceAll(uuid.NewString(), "-", "")
}

func newPublicFileID() string {
	return "file_" + strings.ReplaceAll(uuid.NewString(), "-", "")
}

func buildPublicAPIFileObject(file *model.PublicAPIInputFile) *model.PublicAPIFileObject {
	return &model.PublicAPIFileObject{
		ID:        file.FileID,
		Object:    "file",
		Bytes:     file.SizeBytes,
		CreatedAt: file.CreatedAt.Unix(),
		Filename:  file.Filename,
		Purpose:   file.Purpose,
		MimeType:  file.MimeType,
		Status:    "processed",
	}
}

func sanitizePublicUploadFilename(filename string) string {
	trimmed := strings.TrimSpace(filename)
	if trimmed == "" {
		return ""
	}
	cleaned := filepath.Base(trimmed)
	if cleaned == "." || cleaned == ".." {
		return ""
	}
	return cleaned
}

func buildPublicAPIThreadUploadName(fileID string, originalFilename string) string {
	cleanName := sanitizePublicUploadFilename(originalFilename)
	if cleanName == "" {
		cleanName = "upload"
	}
	extension := filepath.Ext(cleanName)
	stem := strings.TrimSuffix(cleanName, extension)
	suffix := strings.TrimPrefix(strings.TrimSpace(fileID), "file_")
	if len(suffix) > 10 {
		suffix = suffix[:10]
	}
	// The thread uploads directory is historical runtime state, so public API
	// staging uses a deterministic suffix instead of overwriting another file
	// that merely shares the same original basename.
	return fmt.Sprintf("%s--%s%s", stem, suffix, extension)
}

func copyFile(sourcePath string, targetPath string) error {
	src, err := os.Open(sourcePath)
	if err != nil {
		return err
	}
	defer src.Close()

	dst, err := os.Create(targetPath)
	if err != nil {
		return err
	}

	if _, err := io.Copy(dst, src); err != nil {
		_ = dst.Close()
		return err
	}
	return dst.Close()
}

func buildResponseEnvelope(
	invocation *model.PublicAPIInvocation,
	outputText string,
	reasoningText string,
	artifacts []model.PublicAPIResponseArtifact,
	requestMetadata map[string]any,
	previousResponseID string,
	events []model.PublicAPIRunEvent,
	reasoning publicAPINormalizedReasoning,
) map[string]any {
	metadata := make(map[string]any, len(requestMetadata)+1)
	for key, value := range requestMetadata {
		metadata[key] = value
	}
	openagentsMetadata := map[string]any{
		"thread_id": invocation.ThreadID,
	}
	if invocation.TraceID != nil && strings.TrimSpace(*invocation.TraceID) != "" {
		openagentsMetadata["trace_id"] = strings.TrimSpace(*invocation.TraceID)
	}
	if strings.TrimSpace(previousResponseID) != "" {
		openagentsMetadata["previous_response_id"] = strings.TrimSpace(previousResponseID)
	}
	metadata["openagents"] = openagentsMetadata

	outputItems := make([]map[string]any, 0, 2)
	if reasoningSummary := buildReasoningSummary(reasoningText, reasoning); len(reasoningSummary) > 0 {
		outputItems = append(outputItems, map[string]any{
			"id":      "rs_" + strings.TrimPrefix(invocation.ResponseID, "resp_"),
			"type":    "reasoning",
			"status":  "completed",
			"summary": reasoningSummary,
		})
	}
	if strings.TrimSpace(outputText) != "" {
		outputItems = append(outputItems, map[string]any{
			"id":     "msg_" + strings.TrimPrefix(invocation.ResponseID, "resp_"),
			"type":   "message",
			"role":   "assistant",
			"status": "completed",
			"content": []map[string]any{
				{
					"type":        "output_text",
					"text":        outputText,
					"annotations": []any{},
				},
			},
		})
	}

	openagentsExtension := map[string]any{
		"thread_id":  invocation.ThreadID,
		"run_events": events,
	}
	if invocation.TraceID != nil && strings.TrimSpace(*invocation.TraceID) != "" {
		openagentsExtension["trace_id"] = strings.TrimSpace(*invocation.TraceID)
	}
	if strings.TrimSpace(previousResponseID) != "" {
		openagentsExtension["previous_response_id"] = strings.TrimSpace(previousResponseID)
	}

	return map[string]any{
		"id":                   invocation.ResponseID,
		"object":               "response",
		"created_at":           invocation.CreatedAt.Unix(),
		"completed_at":         invocation.FinishedAt.Unix(),
		"status":               invocation.Status,
		"model":                invocation.RequestModel,
		"previous_response_id": emptyStringToNil(previousResponseID),
		"reasoning_effort":     emptyStringToNil(reasoning.Effort),
		"output":               outputItems,
		"output_text":          outputText,
		"usage": map[string]any{
			"input_tokens":  invocation.InputTokens,
			"output_tokens": invocation.OutputTokens,
			"total_tokens":  invocation.TotalTokens,
		},
		"metadata":   metadata,
		"artifacts":  artifacts,
		"openagents": openagentsExtension,
	}
}

func buildStreamingRunEventEnvelope(event model.PublicAPIRunEvent) map[string]any {
	return map[string]any{
		"type":  "response.run_event",
		"event": event,
	}
}

func buildResponseRunEvents(
	invocation *model.PublicAPIInvocation,
	runtimeEvents []model.PublicAPIRunEvent,
	outputText string,
) []model.PublicAPIRunEvent {
	events := make([]model.PublicAPIRunEvent, 0, len(runtimeEvents)+3)
	events = append(events, model.PublicAPIRunEvent{
		EventIndex: 1,
		CreatedAt:  invocation.CreatedAt.Unix(),
		Type:       model.PublicAPIRunStarted,
		ResponseID: invocation.ResponseID,
	})
	events = append(events, runtimeEvents...)
	return append(events, buildTerminalRunEvents(lastRunEventIndex(events), invocation.ResponseID, outputText)...)
}

func buildInterruptedRunEvents(
	invocation *model.PublicAPIInvocation,
	runtimeEvents []model.PublicAPIRunEvent,
) []model.PublicAPIRunEvent {
	events := make([]model.PublicAPIRunEvent, 0, len(runtimeEvents)+1)
	events = append(events, model.PublicAPIRunEvent{
		EventIndex: 1,
		CreatedAt:  invocation.CreatedAt.Unix(),
		Type:       model.PublicAPIRunStarted,
		ResponseID: invocation.ResponseID,
	})
	events = append(events, runtimeEvents...)
	return events
}

func buildTerminalRunEvents(
	startIndex int,
	responseID string,
	outputText string,
) []model.PublicAPIRunEvent {
	events := make([]model.PublicAPIRunEvent, 0, 2)
	nextIndex := startIndex
	createdAt := time.Now().UTC().Unix()
	if strings.TrimSpace(outputText) != "" {
		nextIndex++
		events = append(events, model.PublicAPIRunEvent{
			EventIndex: nextIndex,
			CreatedAt:  createdAt,
			Type:       model.PublicAPIAssistantMessage,
			ResponseID: responseID,
			Text:       outputText,
		})
	}
	nextIndex++
	events = append(events, model.PublicAPIRunEvent{
		EventIndex: nextIndex,
		CreatedAt:  createdAt,
		Type:       model.PublicAPIRunCompleted,
		ResponseID: responseID,
	})
	return events
}

func lastRunEventIndex(events []model.PublicAPIRunEvent) int {
	if len(events) == 0 {
		return 0
	}
	return events[len(events)-1].EventIndex
}

func assistantDeltaFromRunEvents(events []model.PublicAPIRunEvent) string {
	segments := make([]string, 0, len(events))
	for _, event := range events {
		if event.Type == model.PublicAPIAssistantDelta && strings.TrimSpace(event.Delta) != "" {
			segments = append(segments, event.Delta)
		}
	}
	return strings.Join(segments, "")
}

func extractToolCallNames(value any) []string {
	items, ok := value.([]any)
	if !ok {
		return nil
	}
	toolNames := make([]string, 0, len(items))
	for _, item := range items {
		record, ok := item.(map[string]any)
		if !ok {
			continue
		}
		name := strings.TrimSpace(fmt.Sprint(record["name"]))
		if name != "" {
			toolNames = append(toolNames, name)
		}
	}
	return dedupeStrings(toolNames)
}

func buildChatCompletionObject(responseID string, responseObject map[string]any) map[string]any {
	metadata, _ := responseObject["metadata"].(map[string]any)
	if metadata == nil {
		metadata = map[string]any{}
	}
	openagentsMetadata, _ := metadata["openagents"].(map[string]any)
	if openagentsMetadata == nil {
		openagentsMetadata = map[string]any{}
	}
	openagentsMetadata["response_id"] = responseID
	metadata["openagents"] = openagentsMetadata

	usage, _ := responseObject["usage"].(map[string]any)
	if usage == nil {
		usage = map[string]any{}
	}

	return map[string]any{
		"id":      "chatcmpl_" + strings.TrimPrefix(strings.TrimSpace(stringValueAny(responseObject["id"])), "resp_"),
		"object":  "chat.completion",
		"created": responseObject["created_at"],
		"model":   responseObject["model"],
		"choices": []map[string]any{
			{
				"index": 0,
				"message": map[string]any{
					"role":    "assistant",
					"content": responseObject["output_text"],
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
		"artifacts": responseObject["artifacts"],
	}
}

func normalizeJSONObject(raw json.RawMessage) (map[string]any, error) {
	if len(bytes.TrimSpace(raw)) == 0 {
		return map[string]any{}, nil
	}

	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, fmt.Errorf("metadata must be a JSON object")
	}
	return payload, nil
}

func normalizeResponseInput(raw json.RawMessage) (*publicAPINormalizedInput, error) {
	if len(bytes.TrimSpace(raw)) == 0 {
		return nil, fmt.Errorf("input is required")
	}

	var decoded any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return nil, fmt.Errorf("input must be valid JSON")
	}

	collected, err := collectNormalizedInput(decoded)
	if err != nil {
		return nil, err
	}
	normalizedText := strings.TrimSpace(strings.Join(collected.Segments, "\n\n"))
	if normalizedText == "" && len(collected.FileIDs) == 0 {
		return nil, fmt.Errorf("input does not contain any text or input_file content")
	}
	return &publicAPINormalizedInput{
		PromptText: normalizedText,
		FileIDs:    collected.FileIDs,
	}, nil
}

type collectedPublicAPIInput struct {
	Segments []string
	FileIDs  []string
}

func collectNormalizedInput(value any) (collectedPublicAPIInput, error) {
	switch typed := value.(type) {
	case string:
		trimmed := strings.TrimSpace(typed)
		if trimmed == "" {
			return collectedPublicAPIInput{}, nil
		}
		return collectedPublicAPIInput{Segments: []string{trimmed}}, nil
	case []any:
		segments := make([]string, 0)
		fileIDs := make([]string, 0)
		for _, item := range typed {
			collected, err := collectNormalizedInput(item)
			if err != nil {
				return collectedPublicAPIInput{}, err
			}
			segments = append(segments, collected.Segments...)
			fileIDs = append(fileIDs, collected.FileIDs...)
		}
		return collectedPublicAPIInput{
			Segments: segments,
			FileIDs:  dedupeStrings(fileIDs),
		}, nil
	case map[string]any:
		role := strings.TrimSpace(fmt.Sprint(typed["role"]))
		if role != "" && role != "<nil>" {
			content, err := collectNormalizedInput(typed["content"])
			if err != nil {
				return collectedPublicAPIInput{}, err
			}
			if len(content.Segments) == 0 {
				return collectedPublicAPIInput{FileIDs: content.FileIDs}, nil
			}
			return collectedPublicAPIInput{
				Segments: []string{
					formatConversationRole(role) + ":\n" + strings.Join(content.Segments, "\n\n"),
				},
				FileIDs: content.FileIDs,
			}, nil
		}

		blockType := strings.ToLower(strings.TrimSpace(fmt.Sprint(typed["type"])))
		switch blockType {
		case "input_file":
			fileID := strings.TrimSpace(stringValueAny(typed["file_id"]))
			if fileID == "" {
				return collectedPublicAPIInput{}, nil
			}
			return collectedPublicAPIInput{FileIDs: []string{fileID}}, nil
		case "text", "input_text", "output_text":
			if text, ok := typed["text"].(string); ok {
				trimmed := strings.TrimSpace(text)
				if trimmed != "" {
					return collectedPublicAPIInput{Segments: []string{trimmed}}, nil
				}
			}
			if inputText, ok := typed["input_text"].(string); ok {
				trimmed := strings.TrimSpace(inputText)
				if trimmed != "" {
					return collectedPublicAPIInput{Segments: []string{trimmed}}, nil
				}
			}
			return collectedPublicAPIInput{}, nil
		case "":
			// Fall through to nested `content` or generic `text` fields below.
		default:
			return collectedPublicAPIInput{}, fmt.Errorf("unsupported input block type %q", blockType)
		}

		if text, ok := typed["text"].(string); ok {
			trimmed := strings.TrimSpace(text)
			if trimmed != "" {
				return collectedPublicAPIInput{Segments: []string{trimmed}}, nil
			}
		}

		if inputText, ok := typed["input_text"].(string); ok {
			trimmed := strings.TrimSpace(inputText)
			if trimmed != "" {
				return collectedPublicAPIInput{Segments: []string{trimmed}}, nil
			}
		}

		if content, ok := typed["content"]; ok {
			return collectNormalizedInput(content)
		}
	}
	return collectedPublicAPIInput{}, nil
}

func applyStructuredOutputContract(promptText string, options *model.PublicAPITextOptions) (string, error) {
	if options == nil || options.Format == nil {
		return promptText, nil
	}

	formatType := strings.ToLower(strings.TrimSpace(options.Format.Type))
	switch formatType {
	case "", "text":
		return promptText, nil
	case "json_schema":
		schema := strings.TrimSpace(string(options.Format.Schema))
		if schema == "" {
			return "", fmt.Errorf("text.format.schema is required for json_schema output")
		}
		builder := strings.Builder{}
		builder.WriteString(promptText)
		builder.WriteString("\n\nReturn only valid JSON that matches this schema.")
		if options.Format.Name != "" {
			builder.WriteString("\nSchema name: ")
			builder.WriteString(strings.TrimSpace(options.Format.Name))
		}
		if options.Format.Strict {
			builder.WriteString("\nDo not wrap the JSON in markdown fences or add any extra explanation.")
		}
		// Public API structured output is best-effort because the upstream model
		// is not using a native schema-enforced transport. Spell out concrete JSON
		// syntax checks here to reduce common near-miss failures before the gateway
		// performs its final validation.
		builder.WriteString("\nBefore sending the final answer, self-check that the response is valid JSON:")
		builder.WriteString("\n- it starts with { and ends with }")
		builder.WriteString("\n- every property name is followed by a colon")
		builder.WriteString("\n- arrays and objects are closed correctly")
		builder.WriteString("\n- there are no trailing commas")
		builder.WriteString("\n- there is no prose before or after the JSON")
		builder.WriteString("\nJSON Schema:\n")
		builder.WriteString(schema)
		return builder.String(), nil
	default:
		return "", fmt.Errorf("unsupported text.format.type %q", options.Format.Type)
	}
}

func normalizeStructuredOutputText(outputText string, options *model.PublicAPITextOptions) (string, error) {
	trimmed := strings.TrimSpace(outputText)
	if options == nil || options.Format == nil {
		return trimmed, nil
	}
	if !strings.EqualFold(strings.TrimSpace(options.Format.Type), "json_schema") {
		return trimmed, nil
	}
	candidate := trimmed
	switch {
	case json.Valid([]byte(candidate)):
	case func() bool {
		extracted := extractJSONFromMarkdownFence(trimmed)
		if extracted == "" || !json.Valid([]byte(extracted)) {
			return false
		}
		candidate = extracted
		return true
	}():
	case func() bool {
		extracted := extractBalancedJSON(trimmed)
		if extracted == "" || !json.Valid([]byte(extracted)) {
			return false
		}
		candidate = extracted
		return true
	}():
	default:
		return "", fmt.Errorf("runtime did not return valid JSON for json_schema output")
	}

	if !options.Format.Strict {
		return candidate, nil
	}
	if err := validateStructuredOutputSchema(candidate, options.Format.Schema); err != nil {
		return "", err
	}
	return candidate, nil
}

func extractJSONFromMarkdownFence(text string) string {
	start := strings.Index(text, "```")
	if start < 0 {
		return ""
	}
	rest := text[start+3:]
	newline := strings.Index(rest, "\n")
	if newline < 0 {
		return ""
	}
	body := rest[newline+1:]
	end := strings.Index(body, "```")
	if end < 0 {
		return ""
	}
	return strings.TrimSpace(body[:end])
}

func extractBalancedJSON(text string) string {
	start := -1
	for index, r := range text {
		if r == '{' || r == '[' {
			start = index
			break
		}
	}
	if start < 0 {
		return ""
	}

	var (
		depth       int
		inString    bool
		escapeNext  bool
		openingRune rune
		closingRune rune
	)
	for index, r := range text[start:] {
		absoluteIndex := start + index
		if openingRune == 0 {
			openingRune = r
			if openingRune == '{' {
				closingRune = '}'
			} else {
				closingRune = ']'
			}
			depth = 1
			continue
		}

		if escapeNext {
			escapeNext = false
			continue
		}
		if r == '\\' && inString {
			escapeNext = true
			continue
		}
		if r == '"' {
			inString = !inString
			continue
		}
		if inString {
			continue
		}

		switch r {
		case openingRune:
			depth++
		case closingRune:
			depth--
			if depth == 0 {
				return strings.TrimSpace(text[start : absoluteIndex+1])
			}
		}
	}
	return ""
}

func validateStructuredOutputSchema(candidate string, schema json.RawMessage) error {
	schemaBytes := bytes.TrimSpace(schema)
	if len(schemaBytes) == 0 {
		return fmt.Errorf("text.format.schema is required for json_schema output")
	}

	result, err := gojsonschema.Validate(
		gojsonschema.NewBytesLoader(schemaBytes),
		gojsonschema.NewStringLoader(candidate),
	)
	if err != nil {
		return fmt.Errorf("structured output schema validation failed: %w", err)
	}
	if result.Valid() {
		return nil
	}

	messages := make([]string, 0, len(result.Errors()))
	for _, item := range result.Errors() {
		messages = append(messages, item.String())
	}
	return fmt.Errorf("runtime JSON does not match the requested schema: %s", strings.Join(messages, "; "))
}

func extractAssistantResultFromState(payload []byte) (string, string, []string, error) {
	values, err := extractStateValues(payload)
	if err != nil {
		return "", "", nil, err
	}

	artifactPaths := extractStringList(values["artifacts"])
	taskError := extractLatestTaskError(payload)
	messages, _ := values["messages"].([]any)
	reasoningSegments := make([]string, 0, len(messages))
	assistantText := ""
	for index := len(messages) - 1; index >= 0; index-- {
		messageMap, ok := messages[index].(map[string]any)
		if !ok || !isAssistantMessage(messageMap) {
			continue
		}
		text, reasoning := extractMessageParts(messageMap["content"])
		if trimmedReasoning := strings.TrimSpace(reasoning); trimmedReasoning != "" {
			reasoningSegments = append(reasoningSegments, trimmedReasoning)
		}
		if trimmedText := strings.TrimSpace(text); trimmedText != "" && assistantText == "" {
			assistantText = trimmedText
		}
	}
	if assistantText != "" || len(reasoningSegments) > 0 {
		slices.Reverse(reasoningSegments)
		return assistantText, strings.TrimSpace(strings.Join(dedupeStrings(reasoningSegments), "\n\n")), artifactPaths, nil
	}
	if taskError != "" {
		return "", "", artifactPaths, fmt.Errorf("runtime task failed: %s", taskError)
	}
	return "", "", artifactPaths, fmt.Errorf("assistant response text was not found in thread state")
}

func extractStateValues(payload []byte) (map[string]any, error) {
	envelope, err := extractLatestSnapshotEnvelope(payload)
	if err != nil {
		return nil, err
	}
	if values, ok := envelope["values"].(map[string]any); ok {
		return values, nil
	}
	return nil, fmt.Errorf("thread state does not contain values")
}

func hasStateValues(payload []byte) bool {
	values, err := extractStateValues(payload)
	if err != nil {
		return false
	}
	return len(values) > 0
}

func extractLatestTaskError(payload []byte) string {
	envelope, err := extractLatestSnapshotEnvelope(payload)
	if err != nil {
		return ""
	}

	tasks, _ := envelope["tasks"].([]any)
	for index := len(tasks) - 1; index >= 0; index-- {
		task, ok := tasks[index].(map[string]any)
		if !ok {
			continue
		}
		if text := strings.TrimSpace(stringValueAny(task["error"])); text != "" {
			return text
		}
	}
	return ""
}

func extractLatestSnapshotEnvelope(payload []byte) (map[string]any, error) {
	var decoded any
	if err := json.Unmarshal(payload, &decoded); err != nil {
		return nil, err
	}

	switch typed := decoded.(type) {
	case map[string]any:
		return typed, nil
	case []any:
		if len(typed) == 0 {
			return nil, fmt.Errorf("thread state is empty")
		}
		last, ok := typed[len(typed)-1].(map[string]any)
		if !ok {
			return nil, fmt.Errorf("thread state payload is invalid")
		}
		return last, nil
	default:
		return nil, fmt.Errorf("thread state payload is invalid")
	}
}

func extractLangGraphRunError(payload []byte) string {
	trimmed := bytes.TrimSpace(payload)
	if len(trimmed) == 0 {
		return ""
	}

	var decoded map[string]any
	if err := json.Unmarshal(trimmed, &decoded); err != nil {
		return ""
	}

	rawError, ok := decoded["__error__"].(map[string]any)
	if !ok {
		return ""
	}

	errorType := strings.TrimSpace(stringValueAny(rawError["error"]))
	message := strings.TrimSpace(stringValueAny(rawError["message"]))
	switch {
	case errorType != "" && message != "":
		return errorType + ": " + message
	case message != "":
		return message
	default:
		return errorType
	}
}

func stringValueAny(value any) string {
	if text, ok := value.(string); ok {
		return text
	}
	return ""
}

func isAssistantMessage(message map[string]any) bool {
	messageType := strings.ToLower(strings.TrimSpace(fmt.Sprint(message["type"])))
	role := strings.ToLower(strings.TrimSpace(fmt.Sprint(message["role"])))
	return messageType == "ai" || role == "assistant"
}

func extractMessageParts(content any) (string, string) {
	switch typed := content.(type) {
	case string:
		return strings.TrimSpace(typed), ""
	case []any:
		segments := make([]string, 0, len(typed))
		reasoning := make([]string, 0, len(typed))
		for _, item := range typed {
			switch block := item.(type) {
			case string:
				if trimmed := strings.TrimSpace(block); trimmed != "" {
					segments = append(segments, trimmed)
				}
			case map[string]any:
				blockType := strings.ToLower(strings.TrimSpace(fmt.Sprint(block["type"])))
				blockText := strings.TrimSpace(firstNonEmptyString(
					block["text"],
					block["thinking"],
					block["reasoning"],
					block["reasoning_content"],
				))
				if blockText == "" {
					continue
				}
				if blockType == "thinking" || blockType == "reasoning" {
					reasoning = append(reasoning, blockText)
				} else {
					segments = append(segments, blockText)
				}
			}
		}
		return strings.TrimSpace(strings.Join(segments, "\n\n")), strings.TrimSpace(strings.Join(reasoning, "\n\n"))
	default:
		return "", ""
	}
}

func firstNonEmptyString(values ...any) string {
	for _, value := range values {
		if text, ok := value.(string); ok && strings.TrimSpace(text) != "" {
			return text
		}
	}
	return ""
}

func extractStringList(value any) []string {
	items, ok := value.([]any)
	if !ok {
		return []string{}
	}

	result := make([]string, 0, len(items))
	for _, item := range items {
		text, ok := item.(string)
		if !ok {
			continue
		}
		trimmed := strings.TrimSpace(text)
		if trimmed != "" {
			result = append(result, trimmed)
		}
	}
	return result
}

func dedupeStrings(values []string) []string {
	if len(values) == 0 {
		return []string{}
	}

	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		if _, exists := seen[trimmed]; exists {
			continue
		}
		seen[trimmed] = struct{}{}
		result = append(result, trimmed)
	}
	return result
}

func guessMimeType(filePath string) string {
	if guessed := mime.TypeByExtension(strings.ToLower(filepath.Ext(filePath))); guessed != "" {
		return guessed
	}
	return "application/octet-stream"
}

func containsNormalizedText(values []string, target string) bool {
	normalizedTarget := strings.ToLower(strings.TrimSpace(target))
	for _, value := range values {
		if normalizedTarget == strings.ToLower(strings.TrimSpace(value)) {
			return true
		}
	}
	return false
}

func formatConversationRole(role string) string {
	normalized := strings.ToLower(strings.TrimSpace(role))
	if normalized == "" {
		return "User"
	}
	return strings.ToUpper(normalized[:1]) + normalized[1:]
}

func normalizeReasoningOptions(
	options *model.PublicAPIReasoning,
) (publicAPINormalizedReasoning, error) {
	if options == nil {
		return publicAPINormalizedReasoning{}, nil
	}

	effort := strings.ToLower(strings.TrimSpace(options.Effort))
	switch effort {
	case "", "low", "medium", "high", "max":
	default:
		return publicAPINormalizedReasoning{}, fmt.Errorf("unsupported reasoning.effort")
	}

	summary := strings.ToLower(strings.TrimSpace(options.Summary))
	switch summary {
	case "", "auto", "concise", "detailed", "none":
	default:
		return publicAPINormalizedReasoning{}, fmt.Errorf("unsupported reasoning.summary")
	}

	return publicAPINormalizedReasoning{
		ThinkingEnabled: effort != "" || summary != "",
		Effort:          effort,
		Summary:         summary,
	}, nil
}

func validateMaxOutputTokens(value *int) error {
	if value == nil {
		return nil
	}
	if *value <= 0 {
		return fmt.Errorf("max_output_tokens must be greater than zero")
	}
	return nil
}

func emptyStringToNil(value string) any {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	return trimmed
}

func derefInt64(value *int64) int64 {
	if value == nil {
		return 0
	}
	return *value
}

func buildReasoningSummary(
	reasoningText string,
	options publicAPINormalizedReasoning,
) []map[string]any {
	if strings.TrimSpace(reasoningText) == "" || options.Summary == "none" {
		return nil
	}

	text := strings.TrimSpace(reasoningText)
	if options.Summary == "concise" && len(text) > 280 {
		text = strings.TrimSpace(text[:280]) + "..."
	}

	return []map[string]any{
		{
			"type": "summary_text",
			"text": text,
		},
	}
}

func hasNonEmptyToolCalls(value any) bool {
	items, ok := value.([]any)
	return ok && len(items) > 0
}

func extractStreamMessageRecord(payload any) map[string]any {
	switch typed := payload.(type) {
	case map[string]any:
		return typed
	case []any:
		merged := map[string]any{}
		for _, item := range typed {
			record, ok := item.(map[string]any)
			if !ok {
				continue
			}
			if merged["type"] == nil && record["type"] != nil {
				merged["type"] = record["type"]
			}
			if merged["name"] == nil && record["name"] != nil {
				merged["name"] = record["name"]
			}
			if merged["id"] == nil && record["id"] != nil {
				merged["id"] = record["id"]
			}
			if merged["tool_call_id"] == nil && record["tool_call_id"] != nil {
				merged["tool_call_id"] = record["tool_call_id"]
			}
			if content, ok := record["content"]; ok && scoreMessageContent(content) >= scoreMessageContent(merged["content"]) {
				merged["content"] = content
			}
			if toolCalls, ok := record["tool_calls"]; ok && scoreToolCalls(toolCalls) >= scoreToolCalls(merged["tool_calls"]) {
				merged["tool_calls"] = toolCalls
			}
		}
		if len(merged) > 0 {
			return merged
		}
	}
	return map[string]any{}
}

func extractStreamValues(payload any) (map[string]any, bool) {
	record, ok := payload.(map[string]any)
	if !ok {
		return nil, false
	}
	if _, ok := record["messages"].([]any); ok {
		return record, true
	}
	values, ok := record["values"].(map[string]any)
	if !ok {
		return nil, false
	}
	_, hasMessages := values["messages"].([]any)
	return values, hasMessages
}

func extractMessageChunkTextDelta(content any) string {
	switch typed := content.(type) {
	case string:
		return typed
	case []any:
		segments := make([]string, 0, len(typed))
		for _, item := range typed {
			block, ok := item.(map[string]any)
			if !ok {
				continue
			}
			blockType := strings.ToLower(strings.TrimSpace(fmt.Sprint(block["type"])))
			text, ok := block["text"].(string)
			if !ok {
				continue
			}
			if blockType == "" || blockType == "text" {
				segments = append(segments, text)
			}
		}
		return strings.Join(segments, "")
	default:
		return ""
	}
}

func extractToolArgsFromContent(content any, toolName string, toolKey string) any {
	items, ok := content.([]any)
	if !ok {
		return nil
	}

	trimmedName := strings.TrimSpace(toolName)
	trimmedKey := strings.TrimSpace(toolKey)
	for _, item := range items {
		block, ok := item.(map[string]any)
		if !ok {
			continue
		}
		if strings.ToLower(strings.TrimSpace(fmt.Sprint(block["type"]))) != "tool_use" {
			continue
		}
		blockName := strings.TrimSpace(fmt.Sprint(block["name"]))
		blockID := strings.TrimSpace(fmt.Sprint(block["id"]))
		if trimmedName != "" && blockName != "" && blockName != trimmedName {
			continue
		}
		if trimmedKey != "" && blockID != "" && blockID != trimmedKey {
			continue
		}
		if input := block["input"]; !isEmptyStructuredValue(input) {
			return input
		}
		partialJSON := strings.TrimSpace(fmt.Sprint(block["partial_json"]))
		if partialJSON == "" {
			continue
		}
		var decoded any
		if err := json.Unmarshal([]byte(partialJSON), &decoded); err == nil && !isEmptyStructuredValue(decoded) {
			return decoded
		}
	}
	return nil
}

func scoreToolCalls(value any) int {
	items, ok := value.([]any)
	if !ok || len(items) == 0 {
		return 0
	}
	score := len(items)
	for _, item := range items {
		call, ok := item.(map[string]any)
		if !ok {
			continue
		}
		if !isEmptyStructuredValue(firstNonNil(call["args"], call["arguments"])) {
			score += 10
		}
	}
	return score
}

func scoreMessageContent(value any) int {
	score := 0
	if strings.TrimSpace(extractMessageChunkTextDelta(value)) != "" {
		score += 5
	}
	if !isEmptyStructuredValue(extractToolArgsFromContent(value, "", "")) {
		score += 10
	}
	return score
}

func isEmptyStructuredValue(value any) bool {
	if value == nil {
		return true
	}
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed) == ""
	case map[string]any:
		return len(typed) == 0
	case []any:
		return len(typed) == 0
	}
	return false
}

func buildStateSnapshotPayload(
	record map[string]any,
	knownArtifacts map[string]struct{},
) map[string]any {
	payload := map[string]any{}
	if title, ok := record["title"]; ok {
		payload["title"] = title
	}

	artifacts := extractStringList(record["artifacts"])
	if len(artifacts) > 0 {
		payload["artifacts"] = artifacts
	}

	newArtifacts := make([]string, 0, len(artifacts))
	for _, item := range artifacts {
		if _, exists := knownArtifacts[item]; exists {
			continue
		}
		knownArtifacts[item] = struct{}{}
		newArtifacts = append(newArtifacts, item)
	}
	if len(newArtifacts) > 0 {
		payload["new_artifacts"] = newArtifacts
	}

	if messages, ok := record["messages"].([]any); ok {
		payload["message_count"] = len(messages)
	}

	return payload
}

func readSSEStream(
	reader io.Reader,
	onEvent func(sourceEvent string, payload []byte) error,
) error {
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 0, 64*1024), 8*1024*1024)

	eventName := ""
	dataLines := make([]string, 0, 4)
	flushEvent := func() error {
		if eventName == "" && len(dataLines) == 0 {
			return nil
		}
		payload := strings.Join(dataLines, "\n")
		if err := onEvent(eventName, []byte(payload)); err != nil {
			return err
		}
		eventName = ""
		dataLines = dataLines[:0]
		return nil
	}

	for scanner.Scan() {
		line := strings.TrimRight(scanner.Text(), "\r")
		if line == "" {
			if err := flushEvent(); err != nil {
				return err
			}
			continue
		}
		if strings.HasPrefix(line, ":") {
			continue
		}
		switch {
		case strings.HasPrefix(line, "event:"):
			eventName = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
		case strings.HasPrefix(line, "data:"):
			dataLines = append(dataLines, strings.TrimSpace(strings.TrimPrefix(line, "data:")))
		}
	}
	if err := scanner.Err(); err != nil {
		return err
	}
	return flushEvent()
}
