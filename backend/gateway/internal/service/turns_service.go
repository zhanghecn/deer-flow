package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/openagents/gateway/internal/model"
)

type turnCollector struct {
	turnID                string
	events                []model.TurnEvent
	sequence              int
	activeToolCallKeys    map[string]int
	pendingToolCallKeys   map[string]pendingPublicAPIToolCall
	replayedMessageIDs    map[string]struct{}
	replayedToolCallIDs   map[string]struct{}
	startedToolCallKeys   map[string]struct{}
	startedAssistantIDs   map[string]struct{}
	assistantStream       assistantStreamAssembler
	emittedSummaryCounts  map[int]struct{}
	emittedSummaryNoCount bool
}

type turnReplayBoundary struct {
	messageIDs  map[string]struct{}
	toolCallIDs map[string]struct{}
}

func newTurnCollector(turnID string) *turnCollector {
	return &turnCollector{
		turnID:               strings.TrimSpace(turnID),
		events:               make([]model.TurnEvent, 0, 24),
		activeToolCallKeys:   make(map[string]int),
		pendingToolCallKeys:  make(map[string]pendingPublicAPIToolCall),
		replayedMessageIDs:   make(map[string]struct{}),
		replayedToolCallIDs:  make(map[string]struct{}),
		startedToolCallKeys:  make(map[string]struct{}),
		startedAssistantIDs:  make(map[string]struct{}),
		assistantStream:      newAssistantStreamAssembler(),
		emittedSummaryCounts: make(map[int]struct{}),
	}
}

func newTurnReplayBoundary() turnReplayBoundary {
	return turnReplayBoundary{
		messageIDs:  make(map[string]struct{}),
		toolCallIDs: make(map[string]struct{}),
	}
}

func (c *turnCollector) primeReplayBoundary(boundary turnReplayBoundary) {
	for messageID := range boundary.messageIDs {
		c.replayedMessageIDs[messageID] = struct{}{}
	}
	for toolCallID := range boundary.toolCallIDs {
		c.replayedToolCallIDs[toolCallID] = struct{}{}
	}
}

func (c *turnCollector) push(event model.TurnEvent) model.TurnEvent {
	c.sequence++
	event.Sequence = c.sequence
	event.CreatedAt = time.Now().UTC().Unix()
	event.TurnID = c.turnID
	c.events = append(c.events, event)
	return event
}

func (c *turnCollector) consume(sourceEvent string, payload any) []model.TurnEvent {
	switch sourceEvent {
	case "messages", "messages-tuple":
		return c.consumeMessageRecord(extractStreamMessageRecord(payload))
	case "values":
		values, ok := extractStreamValues(payload)
		if !ok {
			return nil
		}
		return c.consumeValues(values)
	case "updates":
		record, ok := payload.(map[string]any)
		if !ok {
			return nil
		}
		return c.consumeInterrupts(record)
	default:
		return nil
	}
}

func (c *turnCollector) consumeValues(values map[string]any) []model.TurnEvent {
	result := c.consumeContextWindow(values["context_window"])
	rawMessages, ok := values["messages"].([]any)
	if !ok {
		return result
	}
	for _, rawMessage := range rawMessages {
		record, ok := rawMessage.(map[string]any)
		if !ok {
			continue
		}
		messageType := strings.ToLower(strings.TrimSpace(fmt.Sprint(record["type"])))
		if strings.HasPrefix(messageType, "ai") {
			result = append(result, c.consumeMessageRecord(record)...)
		}
	}
	return result
}

func (c *turnCollector) consumeContextWindow(payload any) []model.TurnEvent {
	contextWindow, ok := payload.(map[string]any)
	if !ok || contextWindow["summary_applied"] != true {
		return nil
	}

	summaryCount, hasSummaryCount := positiveIntFromAny(contextWindow["summary_count"])
	if hasSummaryCount {
		if _, exists := c.emittedSummaryCounts[summaryCount]; exists {
			return nil
		}
		c.emittedSummaryCounts[summaryCount] = struct{}{}
	} else if c.emittedSummaryNoCount {
		return nil
	} else {
		c.emittedSummaryNoCount = true
	}

	event := model.TurnEvent{
		Type: model.TurnEventContextCompacted,
		Text: "Conversation compacted",
	}
	if hasSummaryCount {
		event.SummaryCount = &summaryCount
	}
	if before, ok := positiveInt64FromAny(contextWindow["approx_input_tokens"]); ok {
		event.ContextBeforeTokens = &before
	}
	if after, ok := positiveInt64FromAny(contextWindow["approx_input_tokens_after_summary"]); ok {
		event.ContextAfterTokens = &after
	}
	if maxTokens, ok := positiveInt64FromAny(contextWindow["max_input_tokens"]); ok {
		event.ContextMaxTokens = &maxTokens
	}

	return []model.TurnEvent{c.push(event)}
}

func (c *turnCollector) consumeContextWindowFromState(payload []byte) []model.TurnEvent {
	values, err := extractStateValues(payload)
	if err != nil {
		return nil
	}
	return c.consumeContextWindow(values["context_window"])
}

func (c *turnCollector) consumeInterrupts(payload map[string]any) []model.TurnEvent {
	interrupts, ok := payload["__interrupt__"].([]any)
	if !ok || len(interrupts) == 0 {
		return nil
	}
	events := make([]model.TurnEvent, 0, len(interrupts))
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
		events = append(events, c.push(model.TurnEvent{
			Type:      model.TurnEventTurnRequiresInput,
			Text:      questionID,
			MessageID: questionID,
		}))
	}
	return events
}

func (c *turnCollector) consumeMessageRecord(record map[string]any) []model.TurnEvent {
	messageType := strings.ToLower(strings.TrimSpace(fmt.Sprint(record["type"])))
	if messageType == "" {
		return nil
	}
	switch {
	case strings.HasPrefix(messageType, "ai"):
		return c.consumeAssistantRecord(record)
	case messageType == "tool":
		return c.consumeToolRecord(record)
	default:
		return nil
	}
}

func (c *turnCollector) consumeAssistantRecord(record map[string]any) []model.TurnEvent {
	events := make([]model.TurnEvent, 0, 4)
	if isSummarizationStreamRecord(record) {
		// Summarization is an internal context-management model call. It may
		// stream text/reasoning chunks, but `/v1/turns` should only expose the
		// user-requested assistant turn.
		return nil
	}
	messageID := assistantMessageID(record)
	if _, isHistorical := c.replayedMessageIDs[messageID]; isHistorical {
		// LangGraph can replay thread history at the start of a streamed run.
		// Drop already-persisted assistant chunks so `/v1/turns` only exposes the
		// current turn instead of restating prior answers.
		return nil
	}
	if _, ok := c.startedAssistantIDs[messageID]; !ok {
		c.startedAssistantIDs[messageID] = struct{}{}
		events = append(events, c.push(model.TurnEvent{
			Type:      model.TurnEventAssistantMessageStarted,
			MessageID: messageID,
		}))
	}

	if textDelta := c.assistantStream.textDelta(messageID, record["content"]); strings.TrimSpace(textDelta) != "" {
		events = append(events, c.push(model.TurnEvent{
			Type:      model.TurnEventAssistantTextDelta,
			MessageID: messageID,
			Delta:     textDelta,
		}))
	}

	if reasoningDelta := c.assistantStream.reasoningDelta(messageID, record["content"]); strings.TrimSpace(reasoningDelta) != "" {
		events = append(events, c.push(model.TurnEvent{
			Type:      model.TurnEventAssistantReasoningDelta,
			MessageID: messageID,
			Delta:     reasoningDelta,
			Reasoning: reasoningDelta,
		}))
	}

	rawCalls, _ := record["tool_calls"].([]any)
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
		if _, isHistorical := c.replayedToolCallIDs[toolKey]; isHistorical {
			continue
		}
		if toolKey != "" {
			if _, ok := c.startedToolCallKeys[toolKey]; ok || c.activeToolCallKeys[toolKey] > 0 {
				continue
			}
		}
		toolArgs := firstNonNil(call["args"], call["arguments"])
		if isEmptyStructuredValue(toolArgs) {
			toolArgs = extractToolArgsFromContent(record["content"], toolName, toolKey)
		}
		if isEmptyStructuredValue(toolArgs) {
			c.pendingToolCallKeys[toolKey] = pendingPublicAPIToolCall{
				ToolName: toolName,
				ToolArgs: toolArgs,
			}
			continue
		}
		if toolKey != "" {
			c.startedToolCallKeys[toolKey] = struct{}{}
			delete(c.pendingToolCallKeys, toolKey)
		}
		c.activeToolCallKeys[toolKey] = 1
		events = append(events, c.push(model.TurnEvent{
			Type:          model.TurnEventToolCallStarted,
			MessageID:     messageID,
			ToolCallID:    toolKey,
			ToolName:      toolName,
			ToolArguments: toolArgs,
		}))
	}

	return events
}

func (c *turnCollector) consumeToolRecord(record map[string]any) []model.TurnEvent {
	toolName := strings.TrimSpace(fmt.Sprint(record["name"]))
	if toolName == "" {
		return nil
	}
	toolKey := strings.TrimSpace(fmt.Sprint(firstNonNil(record["tool_call_id"], record["id"], toolName)))
	if _, isHistorical := c.replayedToolCallIDs[toolKey]; isHistorical {
		return nil
	}
	events := make([]model.TurnEvent, 0, 2)
	if pending, ok := c.pendingToolCallKeys[toolKey]; ok {
		delete(c.pendingToolCallKeys, toolKey)
		c.startedToolCallKeys[toolKey] = struct{}{}
		c.activeToolCallKeys[toolKey] = 1
		events = append(events, c.push(model.TurnEvent{
			Type:          model.TurnEventToolCallStarted,
			ToolCallID:    toolKey,
			ToolName:      pending.ToolName,
			ToolArguments: pending.ToolArgs,
		}))
	}
	if toolKey != "" && c.activeToolCallKeys[toolKey] <= 0 {
		return events
	}
	if toolKey != "" {
		c.activeToolCallKeys[toolKey]--
	}
	events = append(events, c.push(model.TurnEvent{
		Type:       model.TurnEventToolCallCompleted,
		ToolCallID: toolKey,
		ToolName:   toolName,
		ToolOutput: record["content"],
	}))
	return events
}

func extractTurnReplayBoundaryFromState(payload []byte) turnReplayBoundary {
	boundary := newTurnReplayBoundary()
	values, err := extractStateValues(payload)
	if err != nil {
		return boundary
	}

	rawMessages, ok := values["messages"].([]any)
	if !ok {
		return boundary
	}

	for _, rawMessage := range rawMessages {
		record, ok := rawMessage.(map[string]any)
		if !ok {
			continue
		}

		if messageID := strings.TrimSpace(fmt.Sprint(record["id"])); messageID != "" {
			boundary.messageIDs[messageID] = struct{}{}
		}

		if toolResultID := strings.TrimSpace(fmt.Sprint(firstNonNil(record["tool_call_id"], record["id"]))); toolResultID != "" {
			if strings.EqualFold(strings.TrimSpace(fmt.Sprint(record["type"])), "tool") {
				boundary.toolCallIDs[toolResultID] = struct{}{}
			}
		}

		rawCalls, _ := record["tool_calls"].([]any)
		for _, rawCall := range rawCalls {
			call, ok := rawCall.(map[string]any)
			if !ok {
				continue
			}
			if toolCallID := strings.TrimSpace(fmt.Sprint(call["id"])); toolCallID != "" {
				boundary.toolCallIDs[toolCallID] = struct{}{}
			}
		}
	}

	return boundary
}

func positiveIntFromAny(value any) (int, bool) {
	number, ok := positiveInt64FromAny(value)
	if !ok || number > int64(^uint(0)>>1) {
		return 0, false
	}
	return int(number), true
}

func positiveInt64FromAny(value any) (int64, bool) {
	switch typed := value.(type) {
	case int:
		if typed > 0 {
			return int64(typed), true
		}
	case int64:
		if typed > 0 {
			return typed, true
		}
	case float64:
		if typed > 0 {
			return int64(typed), true
		}
	case json.Number:
		if parsed, err := typed.Int64(); err == nil && parsed > 0 {
			return parsed, true
		}
	case string:
		if parsed, err := strconv.ParseInt(strings.TrimSpace(typed), 10, 64); err == nil && parsed > 0 {
			return parsed, true
		}
	}
	return 0, false
}

func translateTurnRequest(request model.TurnCreateRequest) (model.PublicAPIResponsesRequest, error) {
	prompt := strings.TrimSpace(request.Input.Text)
	if prompt == "" && len(request.Input.FileIDs) == 0 {
		return model.PublicAPIResponsesRequest{}, &PublicAPIError{
			StatusCode: http.StatusBadRequest,
			Code:       "invalid_input",
			Message:    "input.text or input.file_ids is required",
		}
	}

	content := make([]map[string]any, 0, 1+len(request.Input.FileIDs))
	if prompt != "" {
		content = append(content, map[string]any{
			"type": "input_text",
			"text": prompt,
		})
	}
	for _, fileID := range request.Input.FileIDs {
		if trimmed := strings.TrimSpace(fileID); trimmed != "" {
			content = append(content, map[string]any{
				"type":    "input_file",
				"file_id": trimmed,
			})
		}
	}

	input, err := json.Marshal([]map[string]any{{
		"role":    "user",
		"content": content,
	}})
	if err != nil {
		return model.PublicAPIResponsesRequest{}, err
	}

	var reasoning *model.PublicAPIReasoning
	if request.Thinking != nil && request.Thinking.Enabled {
		reasoning = &model.PublicAPIReasoning{
			Effort:  strings.TrimSpace(request.Thinking.Effort),
			Summary: "detailed",
		}
	}

	return model.PublicAPIResponsesRequest{
		Model:              strings.TrimSpace(request.Agent),
		Input:              input,
		SessionID:          strings.TrimSpace(request.SessionID),
		PreviousResponseID: strings.TrimSpace(request.PreviousTurnID),
		Metadata:           request.Metadata,
		Stream:             request.Stream,
		Text:               request.Text,
		Reasoning:          reasoning,
		MaxOutputTokens:    request.MaxOutputTokens,
	}, nil
}

func normalizeKnowledgeBaseIDs(values []string) ([]string, error) {
	if values == nil {
		return nil, nil
	}
	if len(values) == 0 {
		return []string{}, nil
	}

	seen := make(map[string]struct{}, len(values))
	normalized := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			return nil, &PublicAPIError{
				StatusCode: http.StatusBadRequest,
				Code:       "invalid_knowledge_base_ids",
				Message:    "knowledge_base_ids cannot contain empty values",
			}
		}
		parsed, err := uuid.Parse(trimmed)
		if err != nil {
			return nil, &PublicAPIError{
				StatusCode: http.StatusBadRequest,
				Code:       "invalid_knowledge_base_ids",
				Message:    "knowledge_base_ids must contain valid UUID values",
			}
		}
		id := parsed.String()
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		normalized = append(normalized, id)
	}
	return normalized, nil
}

func normalizeTurnKnowledgeBaseIDs(values []string) ([]string, error) {
	return normalizeKnowledgeBaseIDs(values)
}

func mergeKnowledgeBaseIDs(defaultIDs []string, requestIDs []string) ([]string, error) {
	combined := make([]string, 0, len(defaultIDs)+len(requestIDs))
	combined = append(combined, defaultIDs...)
	combined = append(combined, requestIDs...)
	return normalizeKnowledgeBaseIDs(combined)
}

func requireTurnKnowledgeScope(auth PublicAPIAuthContext, knowledgeBaseIDs []string) error {
	if len(knowledgeBaseIDs) == 0 {
		return nil
	}
	if containsNormalizedText(auth.Scopes, "knowledge:read") {
		return nil
	}
	return &PublicAPIError{
		StatusCode: http.StatusForbidden,
		Code:       "insufficient_scope",
		Message:    "api token is missing knowledge:read",
	}
}

func (s *PublicAPIService) attachTurnKnowledgeBases(
	ctx context.Context,
	auth PublicAPIAuthContext,
	threadID string,
	knowledgeBaseIDs []string,
) error {
	if len(knowledgeBaseIDs) == 0 {
		return nil
	}
	if s.knowledgeRepo == nil {
		return &PublicAPIError{
			StatusCode: http.StatusInternalServerError,
			Code:       "knowledge_unavailable",
			Message:    "knowledge base attachments are not configured",
		}
	}

	for _, knowledgeBaseID := range knowledgeBaseIDs {
		// Public SDK turns must reuse the same persisted thread attachment table
		// as the workspace UI; runtime prompts then see one stable KB contract.
		if err := s.knowledgeRepo.AttachBaseToThread(ctx, auth.UserID, threadID, knowledgeBaseID); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return &PublicAPIError{
					StatusCode: http.StatusNotFound,
					Code:       "knowledge_base_not_found",
					Message:    "knowledge base not found",
				}
			}
			return err
		}
	}
	return nil
}

func (s *PublicAPIService) attachRunKnowledgeBases(
	ctx context.Context,
	plan *publicAPIRunPlan,
	requestKnowledgeBaseIDs []string,
) error {
	knowledgeBaseIDs, err := mergeKnowledgeBaseIDs(
		plan.AgentKnowledgeBaseIDs,
		requestKnowledgeBaseIDs,
	)
	if err != nil {
		return err
	}
	if err := requireTurnKnowledgeScope(plan.Auth, knowledgeBaseIDs); err != nil {
		return err
	}
	return s.attachTurnKnowledgeBases(ctx, plan.Auth, plan.ThreadID, knowledgeBaseIDs)
}

func buildTurnSnapshot(
	invocation *model.PublicAPIInvocation,
	agentName string,
	sessionID string,
	previousTurnID string,
	outputText string,
	reasoningText string,
	artifacts []model.PublicAPIResponseArtifact,
	events []model.TurnEvent,
	metadata map[string]any,
) *model.TurnSnapshot {
	snapshot := &model.TurnSnapshot{
		ID:            invocation.ResponseID,
		Object:        "turn",
		Status:        invocation.Status,
		Agent:         agentName,
		SessionID:     strings.TrimSpace(sessionID),
		ThreadID:      invocation.ThreadID,
		OutputText:    outputText,
		ReasoningText: reasoningText,
		Artifacts:     artifacts,
		Events:        events,
		CreatedAt:     invocation.CreatedAt.UTC().Unix(),
		Usage: model.TurnUsage{
			InputTokens:  invocation.InputTokens,
			OutputTokens: invocation.OutputTokens,
			TotalTokens:  invocation.TotalTokens,
		},
	}
	if invocation.TraceID != nil {
		snapshot.TraceID = strings.TrimSpace(*invocation.TraceID)
	}
	if invocation.FinishedAt != nil {
		snapshot.CompletedAt = invocation.FinishedAt.UTC().Unix()
	}
	if strings.TrimSpace(previousTurnID) != "" {
		snapshot.PreviousTurnID = strings.TrimSpace(previousTurnID)
	}
	if len(metadata) > 0 {
		snapshot.Metadata = metadata
	}
	return snapshot
}

func (s *PublicAPIService) failTurnExecution(
	ctx context.Context,
	plan *publicAPIRunPlan,
	collector *turnCollector,
	onEvent func(event model.TurnEvent) error,
	stage model.TurnFailureStage,
	cause error,
	outputText string,
	reasoningText string,
) error {
	failed := collector.push(BuildPublicTurnFailureEvent(plan.ResponseID, stage, cause))
	finalErr := s.finishInvocationWithError(ctx, plan.Invocation, wrapPublicAPITurnFailure(cause, publicAPITurnFailureContext{
		TurnID:         plan.ResponseID,
		SessionID:      plan.SessionID,
		Stage:          stage,
		Events:         collector.events,
		PreviousTurnID: plan.PreviousResponseID,
		Metadata:       plan.Metadata,
		OutputText:     outputText,
		ReasoningText:  reasoningText,
	}), nil)
	if onEvent != nil {
		if err := onEvent(failed); err != nil {
			return err
		}
	}
	return wrapHandledTurnExecutionError(finalErr)
}

func (s *PublicAPIService) executeTurn(
	ctx context.Context,
	plan *publicAPIRunPlan,
	collector *turnCollector,
	onEvent func(event model.TurnEvent) error,
) (*model.TurnSnapshot, error) {
	if strings.TrimSpace(plan.PreviousResponseID) != "" {
		// Seed the collector with the thread's pre-run message/tool identifiers so
		// a history replay from LangGraph does not leak the previous answer into
		// the new `/v1/turns` SSE stream.
		if statePayload, err := s.fetchThreadState(
			ctx,
			plan.Auth.UserID,
			plan.ThreadID,
			plan.AgentName,
			plan.ModelName,
		); err == nil {
			collector.primeReplayBoundary(extractTurnReplayBoundaryFromState(statePayload))
		}
	}

	started := collector.push(model.TurnEvent{Type: model.TurnEventTurnStarted})
	if onEvent != nil {
		if err := onEvent(started); err != nil {
			return nil, err
		}
	}

	streamErr := s.runAgentTurnStream(ctx, plan, func(sourceEvent string, payload any) error {
		for _, event := range collector.consume(sourceEvent, payload) {
			if onEvent != nil {
				if err := onEvent(event); err != nil {
					return err
				}
			}
		}
		return nil
	})
	if streamErr != nil {
		return nil, s.failTurnExecution(
			ctx,
			plan,
			collector,
			onEvent,
			model.TurnFailureStageStreamExecution,
			streamErr,
			"",
			"",
		)
	}

	statePayload, err := s.fetchThreadState(
		ctx,
		plan.Auth.UserID,
		plan.ThreadID,
		plan.AgentName,
		plan.ModelName,
	)
	if err != nil {
		return nil, s.failTurnExecution(
			ctx,
			plan,
			collector,
			onEvent,
			model.TurnFailureStageStateFetch,
			err,
			"",
			"",
		)
	}

	outputText, reasoningText, artifactPaths, err := extractAssistantResultFromState(statePayload)
	if err != nil {
		return nil, s.failTurnExecution(
			ctx,
			plan,
			collector,
			onEvent,
			model.TurnFailureStageSnapshotBuild,
			err,
			"",
			"",
		)
	}

	for _, event := range collector.consumeContextWindowFromState(statePayload) {
		if onEvent != nil {
			if err := onEvent(event); err != nil {
				return nil, err
			}
		}
	}
	outputText, err = normalizeStructuredOutputText(outputText, plan.Request.Text)
	if err != nil {
		return nil, s.failTurnExecution(
			ctx,
			plan,
			collector,
			onEvent,
			model.TurnFailureStageSnapshotBuild,
			err,
			outputText,
			reasoningText,
		)
	}

	if err := s.applyTraceUsage(ctx, plan); err != nil {
		return nil, s.failTurnExecution(
			ctx,
			plan,
			collector,
			onEvent,
			model.TurnFailureStageSnapshotBuild,
			err,
			outputText,
			reasoningText,
		)
	}

	responseArtifacts, ledgerArtifacts, err := s.buildResponseArtifacts(plan.Invocation, artifactPaths)
	if err != nil {
		return nil, s.failTurnExecution(
			ctx,
			plan,
			collector,
			onEvent,
			model.TurnFailureStageSnapshotBuild,
			err,
			outputText,
			reasoningText,
		)
	}
	if len(ledgerArtifacts) > 0 {
		if err := s.invocationRepo.AttachArtifacts(ctx, ledgerArtifacts); err != nil {
			return nil, s.failTurnExecution(
				ctx,
				plan,
				collector,
				onEvent,
				model.TurnFailureStageSnapshotBuild,
				err,
				outputText,
				reasoningText,
			)
		}
	}

	assistantDone := collector.push(model.TurnEvent{
		Type:      model.TurnEventAssistantMessageCompleted,
		Text:      outputText,
		Reasoning: reasoningText,
	})
	if onEvent != nil {
		if err := onEvent(assistantDone); err != nil {
			return nil, err
		}
	}

	plan.Invocation.Status = "completed"
	finishedAt := time.Now().UTC()
	plan.Invocation.FinishedAt = &finishedAt
	snapshot := buildTurnSnapshot(
		plan.Invocation,
		plan.AgentName,
		plan.SessionID,
		plan.PreviousResponseID,
		outputText,
		reasoningText,
		responseArtifacts,
		collector.events,
		plan.Metadata,
	)
	completed := collector.push(model.TurnEvent{
		Type:      model.TurnEventTurnCompleted,
		Text:      outputText,
		Reasoning: reasoningText,
	})
	snapshot.Events = collector.events
	if onEvent != nil {
		if err := onEvent(completed); err != nil {
			return nil, err
		}
	}

	responseBody, err := json.Marshal(snapshot)
	if err != nil {
		return nil, err
	}
	plan.Invocation.ResponseJSON = responseBody
	if err := s.invocationRepo.Finish(ctx, plan.Invocation); err != nil {
		return nil, err
	}
	return snapshot, nil
}

func (s *PublicAPIService) CreateTurn(
	ctx context.Context,
	auth PublicAPIAuthContext,
	request model.TurnCreateRequest,
	rawBody json.RawMessage,
) (*model.TurnSnapshot, error) {
	knowledgeBaseIDs, err := normalizeTurnKnowledgeBaseIDs(request.KnowledgeBaseIDs)
	if err != nil {
		return nil, err
	}
	responsesRequest, err := translateTurnRequest(request)
	if err != nil {
		return nil, err
	}
	plan, err := s.prepareRun(ctx, auth, "turns", responsesRequest, rawBody)
	if err != nil {
		return nil, err
	}
	if err := s.attachRunKnowledgeBases(ctx, plan, knowledgeBaseIDs); err != nil {
		return nil, s.finishInvocationWithError(ctx, plan.Invocation, wrapPublicAPITurnFailure(err, publicAPITurnFailureContext{
			TurnID:         plan.ResponseID,
			SessionID:      plan.SessionID,
			Stage:          model.TurnFailureStagePrepareRun,
			PreviousTurnID: plan.PreviousResponseID,
			Metadata:       plan.Metadata,
		}), nil)
	}
	snapshot, err := s.executeTurn(ctx, plan, newTurnCollector(plan.ResponseID), nil)
	if err != nil {
		if unwrapped, ok := unwrapHandledTurnExecutionError(err); ok {
			return nil, unwrapped
		}
		return nil, err
	}
	return snapshot, nil
}

func (s *PublicAPIService) StreamTurn(
	ctx context.Context,
	auth PublicAPIAuthContext,
	request model.TurnCreateRequest,
	rawBody json.RawMessage,
	emit func(eventName string, payload any) error,
) error {
	knowledgeBaseIDs, err := normalizeTurnKnowledgeBaseIDs(request.KnowledgeBaseIDs)
	if err != nil {
		return err
	}
	responsesRequest, err := translateTurnRequest(request)
	if err != nil {
		return err
	}
	plan, err := s.prepareRun(ctx, auth, "turns", responsesRequest, rawBody)
	if err != nil {
		return err
	}
	if err := s.attachRunKnowledgeBases(ctx, plan, knowledgeBaseIDs); err != nil {
		return s.finishInvocationWithError(ctx, plan.Invocation, wrapPublicAPITurnFailure(err, publicAPITurnFailureContext{
			TurnID:         plan.ResponseID,
			SessionID:      plan.SessionID,
			Stage:          model.TurnFailureStagePrepareRun,
			PreviousTurnID: plan.PreviousResponseID,
			Metadata:       plan.Metadata,
		}), nil)
	}
	_, err = s.executeTurn(ctx, plan, newTurnCollector(plan.ResponseID), func(event model.TurnEvent) error {
		if emit == nil {
			return nil
		}
		return emit(string(event.Type), event)
	})
	if err != nil {
		var handled *handledTurnExecutionError
		if errors.As(err, &handled) {
			return nil
		}
		return err
	}
	if emit != nil {
		return emit("done", map[string]any{})
	}
	return nil
}

func (s *PublicAPIService) GetTurn(
	ctx context.Context,
	turnID string,
	apiTokenID uuid.UUID,
) (*model.TurnSnapshot, error) {
	invocation, err := s.invocationRepo.GetByResponseID(ctx, strings.TrimSpace(turnID), apiTokenID)
	if err != nil {
		return nil, err
	}
	if invocation == nil {
		return nil, &PublicAPIError{
			StatusCode: http.StatusNotFound,
			Code:       "turn_not_found",
			Message:    "turn was not found",
		}
	}
	var snapshot model.TurnSnapshot
	if err := json.Unmarshal(invocation.ResponseJSON, &snapshot); err != nil {
		return nil, &PublicAPIError{
			StatusCode: http.StatusInternalServerError,
			Code:       "invalid_turn_snapshot",
			Message:    "stored turn snapshot is invalid",
		}
	}
	return &snapshot, nil
}

func (s *PublicAPIService) ListRecentTurns(
	ctx context.Context,
	auth PublicAPIAuthContext,
	agentName string,
	sessionID string,
	limit int,
) (*model.TurnListResponse, error) {
	normalizedAgentName := strings.ToLower(strings.TrimSpace(agentName))
	if normalizedAgentName == "" {
		return nil, &PublicAPIError{
			StatusCode: http.StatusBadRequest,
			Code:       "invalid_agent",
			Message:    "agent is required",
		}
	}
	if auth.UserID == uuid.Nil || auth.APITokenID == uuid.Nil {
		return nil, &PublicAPIError{
			StatusCode: http.StatusUnauthorized,
			Code:       "unauthorized",
			Message:    "api token is required",
		}
	}
	if len(auth.AllowedAgents) > 0 && !containsNormalizedText(auth.AllowedAgents, normalizedAgentName) {
		return nil, &PublicAPIError{
			StatusCode: http.StatusForbidden,
			Code:       "agent_not_allowed",
			Message:    "api token is not allowed to access this agent",
		}
	}
	normalizedSessionID, err := normalizePublicAPISessionID(sessionID)
	if err != nil {
		return nil, err
	}
	if normalizedSessionID == "" {
		return s.listRecentTurnSessions(ctx, auth, normalizedAgentName, limit)
	}

	normalizedLimit := normalizeRecentTurnLimit(limit)
	tokenID := auth.APITokenID
	invocations, err := s.invocationRepo.ListByUser(ctx, auth.UserID, model.PublicAPIInvocationFilter{
		APITokenID:   &tokenID,
		AgentName:    normalizedAgentName,
		ThreadID:     publicAPISessionThreadID(auth.APITokenID, normalizedAgentName, normalizedSessionID),
		Surface:      "turns",
		FinishedOnly: true,
		Limit:        normalizedLimit,
	})
	if err != nil {
		return nil, err
	}

	items := make([]model.TurnHistoryItem, 0, len(invocations))
	for _, invocation := range invocations {
		var snapshot model.TurnSnapshot
		if err := json.Unmarshal(invocation.ResponseJSON, &snapshot); err != nil {
			return nil, &PublicAPIError{
				StatusCode: http.StatusInternalServerError,
				Code:       "invalid_turn_snapshot",
				Message:    "stored turn snapshot is invalid",
			}
		}
		if strings.TrimSpace(snapshot.SessionID) == "" {
			snapshot.SessionID = normalizedSessionID
		}
		items = append(items, model.TurnHistoryItem{
			TurnSnapshot: snapshot,
			Input:        extractTurnInputFromRequestJSON(invocation.RequestJSON),
		})
	}

	return &model.TurnListResponse{
		Object: "list",
		Data:   items,
	}, nil
}

func (s *PublicAPIService) listRecentTurnSessions(
	ctx context.Context,
	auth PublicAPIAuthContext,
	agentName string,
	limit int,
) (*model.TurnListResponse, error) {
	normalizedLimit := normalizeRecentTurnLimit(limit)
	tokenID := auth.APITokenID
	invocations, err := s.invocationRepo.ListByUser(ctx, auth.UserID, model.PublicAPIInvocationFilter{
		APITokenID:   &tokenID,
		AgentName:    agentName,
		Surface:      "turns",
		FinishedOnly: true,
		// Pull a wider turn window because multiple recent turns can belong to
		// the same SDK session; the response is limited after session grouping.
		Limit: 200,
	})
	if err != nil {
		return nil, err
	}

	type sessionSummary struct {
		sessionID  string
		latest     model.PublicAPIInvocation
		firstInput model.TurnInput
	}
	summaries := make([]sessionSummary, 0, normalizedLimit)
	indexBySession := make(map[string]int)
	for _, invocation := range invocations {
		sessionID := strings.TrimSpace(extractSessionIDFromRequestJSON(invocation.RequestJSON))
		if sessionID == "" {
			sessionID = strings.TrimSpace(extractSessionIDFromResponseJSON(invocation.ResponseJSON))
		}
		if sessionID == "" {
			continue
		}
		input := extractTurnInputFromRequestJSON(invocation.RequestJSON)
		if existingIndex, ok := indexBySession[sessionID]; ok {
			// Repository rows are newest-first, so every later match is older.
			// Keep overwriting the label input so the final summary shows the
			// first visible user question for that session.
			summaries[existingIndex].firstInput = input
			continue
		}
		if len(summaries) >= normalizedLimit {
			continue
		}
		indexBySession[sessionID] = len(summaries)
		summaries = append(summaries, sessionSummary{
			sessionID:  sessionID,
			latest:     invocation,
			firstInput: input,
		})
	}

	items := make([]model.TurnHistoryItem, 0, len(summaries))
	for _, summary := range summaries {
		var snapshot model.TurnSnapshot
		if err := json.Unmarshal(summary.latest.ResponseJSON, &snapshot); err != nil {
			return nil, &PublicAPIError{
				StatusCode: http.StatusInternalServerError,
				Code:       "invalid_turn_snapshot",
				Message:    "stored turn snapshot is invalid",
			}
		}
		if strings.TrimSpace(snapshot.SessionID) == "" {
			snapshot.SessionID = summary.sessionID
		}
		items = append(items, model.TurnHistoryItem{
			TurnSnapshot: snapshot,
			Input:        summary.firstInput,
		})
	}

	return &model.TurnListResponse{
		Object: "list",
		Data:   items,
	}, nil
}

func normalizeRecentTurnLimit(limit int) int {
	if limit <= 0 {
		return 10
	}
	if limit > 50 {
		return 50
	}
	return limit
}

func extractTurnInputFromRequestJSON(requestJSON json.RawMessage) model.TurnInput {
	var request model.TurnCreateRequest
	if err := json.Unmarshal(requestJSON, &request); err != nil {
		return model.TurnInput{}
	}
	// Request JSON is the public northbound ledger; trimming here keeps the
	// history payload consistent with the text that originally seeded the run.
	return model.TurnInput{
		Text:    strings.TrimSpace(request.Input.Text),
		FileIDs: request.Input.FileIDs,
	}
}

func extractSessionIDFromRequestJSON(requestJSON json.RawMessage) string {
	var turnRequest model.TurnCreateRequest
	if err := json.Unmarshal(requestJSON, &turnRequest); err == nil && strings.TrimSpace(turnRequest.SessionID) != "" {
		return strings.TrimSpace(turnRequest.SessionID)
	}
	var responseRequest model.PublicAPIResponsesRequest
	if err := json.Unmarshal(requestJSON, &responseRequest); err == nil && strings.TrimSpace(responseRequest.SessionID) != "" {
		return strings.TrimSpace(responseRequest.SessionID)
	}
	return ""
}

func extractSessionIDFromResponseJSON(responseJSON json.RawMessage) string {
	var response struct {
		SessionID string `json:"session_id"`
		Metadata  struct {
			OpenAgents struct {
				SessionID string `json:"session_id"`
			} `json:"openagents"`
		} `json:"metadata"`
		OpenAgents struct {
			SessionID string `json:"session_id"`
		} `json:"openagents"`
	}
	if err := json.Unmarshal(responseJSON, &response); err != nil {
		return ""
	}
	// Response-compatibility snapshots store SDK session metadata under
	// openagents; turns store it at the top level and are handled before this.
	if strings.TrimSpace(response.SessionID) != "" {
		return strings.TrimSpace(response.SessionID)
	}
	if strings.TrimSpace(response.OpenAgents.SessionID) != "" {
		return strings.TrimSpace(response.OpenAgents.SessionID)
	}
	return strings.TrimSpace(response.Metadata.OpenAgents.SessionID)
}
