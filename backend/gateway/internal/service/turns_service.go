package service

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/openagents/gateway/internal/model"
)

type turnCollector struct {
	turnID               string
	events               []model.TurnEvent
	sequence             int
	activeToolCallKeys   map[string]int
	pendingToolCallKeys  map[string]pendingPublicAPIToolCall
	replayedMessageIDs   map[string]struct{}
	replayedToolCallIDs  map[string]struct{}
	startedToolCallKeys  map[string]struct{}
	startedAssistantIDs  map[string]struct{}
	lastReasoningByMsgID map[string]string
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
		lastReasoningByMsgID: make(map[string]string),
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
	rawMessages, ok := values["messages"].([]any)
	if !ok {
		return nil
	}
	result := make([]model.TurnEvent, 0, 2)
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
	messageID := strings.TrimSpace(fmt.Sprint(record["id"]))
	if _, isHistorical := c.replayedMessageIDs[messageID]; isHistorical {
		// LangGraph can replay thread history at the start of a streamed run.
		// Drop already-persisted assistant chunks so `/v1/turns` only exposes the
		// current turn instead of restating prior answers.
		return nil
	}
	if messageID == "" {
		messageID = fmt.Sprintf("assistant:%d", len(c.startedAssistantIDs)+1)
	}
	if _, ok := c.startedAssistantIDs[messageID]; !ok {
		c.startedAssistantIDs[messageID] = struct{}{}
		events = append(events, c.push(model.TurnEvent{
			Type:      model.TurnEventAssistantMessageStarted,
			MessageID: messageID,
		}))
	}

	if textDelta := extractMessageChunkTextDelta(record["content"]); strings.TrimSpace(textDelta) != "" {
		events = append(events, c.push(model.TurnEvent{
			Type:      model.TurnEventAssistantTextDelta,
			MessageID: messageID,
			Delta:     textDelta,
		}))
	}

	if reasoningDelta := c.extractReasoningDelta(messageID, record["content"]); strings.TrimSpace(reasoningDelta) != "" {
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

func (c *turnCollector) extractReasoningDelta(messageID string, content any) string {
	current := extractReasoningFromContentBlocks(content)
	if strings.TrimSpace(current) == "" {
		return ""
	}
	previous := c.lastReasoningByMsgID[messageID]
	switch {
	case previous == "":
		c.lastReasoningByMsgID[messageID] = current
		return current
	case current == previous:
		return ""
	case strings.HasPrefix(current, previous):
		delta := current[len(previous):]
		c.lastReasoningByMsgID[messageID] = current
		return delta
	case strings.HasPrefix(previous, current):
		return ""
	default:
		c.lastReasoningByMsgID[messageID] = current
		return current
	}
}

func extractReasoningFromContentBlocks(content any) string {
	items, ok := content.([]any)
	if !ok {
		return ""
	}
	segments := make([]string, 0, len(items))
	for _, item := range items {
		block, ok := item.(map[string]any)
		if !ok {
			continue
		}
		blockType := strings.ToLower(strings.TrimSpace(fmt.Sprint(block["type"])))
		if blockType != "thinking" && blockType != "reasoning" {
			continue
		}
		text := firstNonEmptyString(
			block["thinking"],
			block["reasoning"],
			block["reasoning_content"],
			block["text"],
		)
		if strings.TrimSpace(text) != "" {
			segments = append(segments, text)
		}
	}
	return strings.Join(segments, "\n\n")
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
		PreviousResponseID: strings.TrimSpace(request.PreviousTurnID),
		Metadata:           request.Metadata,
		Stream:             request.Stream,
		Text:               request.Text,
		Reasoning:          reasoning,
		MaxOutputTokens:    request.MaxOutputTokens,
	}, nil
}

func buildTurnSnapshot(
	invocation *model.PublicAPIInvocation,
	agentName string,
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
		failed := collector.push(model.TurnEvent{
			Type:  model.TurnEventTurnFailed,
			Error: streamErr.Error(),
		})
		_ = s.finishInvocationWithError(ctx, plan.Invocation, streamErr, nil)
		if onEvent != nil {
			_ = onEvent(failed)
		}
		return nil, streamErr
	}

	statePayload, err := s.fetchThreadState(
		ctx,
		plan.Auth.UserID,
		plan.ThreadID,
		plan.AgentName,
		plan.ModelName,
	)
	if err != nil {
		_ = s.finishInvocationWithError(ctx, plan.Invocation, err, nil)
		return nil, err
	}

	outputText, reasoningText, artifactPaths, err := extractAssistantResultFromState(statePayload)
	if err != nil {
		_ = s.finishInvocationWithError(ctx, plan.Invocation, err, nil)
		return nil, err
	}
	outputText, err = normalizeStructuredOutputText(outputText, plan.Request.Text)
	if err != nil {
		_ = s.finishInvocationWithError(ctx, plan.Invocation, err, nil)
		return nil, err
	}

	if err := s.applyTraceUsage(ctx, plan); err != nil {
		_ = s.finishInvocationWithError(ctx, plan.Invocation, err, nil)
		return nil, err
	}

	responseArtifacts, ledgerArtifacts, err := s.buildResponseArtifacts(plan.Invocation, artifactPaths)
	if err != nil {
		_ = s.finishInvocationWithError(ctx, plan.Invocation, err, nil)
		return nil, err
	}
	if len(ledgerArtifacts) > 0 {
		if err := s.invocationRepo.AttachArtifacts(ctx, ledgerArtifacts); err != nil {
			_ = s.finishInvocationWithError(ctx, plan.Invocation, err, nil)
			return nil, err
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
	responsesRequest, err := translateTurnRequest(request)
	if err != nil {
		return nil, err
	}
	plan, err := s.prepareRun(ctx, auth, "turns", responsesRequest, rawBody)
	if err != nil {
		return nil, err
	}
	return s.executeTurn(ctx, plan, newTurnCollector(plan.ResponseID), nil)
}

func (s *PublicAPIService) StreamTurn(
	ctx context.Context,
	auth PublicAPIAuthContext,
	request model.TurnCreateRequest,
	rawBody json.RawMessage,
	emit func(eventName string, payload any) error,
) error {
	responsesRequest, err := translateTurnRequest(request)
	if err != nil {
		return err
	}
	plan, err := s.prepareRun(ctx, auth, "turns", responsesRequest, rawBody)
	if err != nil {
		return err
	}
	_, err = s.executeTurn(ctx, plan, newTurnCollector(plan.ResponseID), func(event model.TurnEvent) error {
		if emit == nil {
			return nil
		}
		return emit(string(event.Type), event)
	})
	if err != nil {
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
