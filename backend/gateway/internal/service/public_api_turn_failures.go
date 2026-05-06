package service

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/openagents/gateway/internal/model"
)

type publicAPITurnFailureContext struct {
	TurnID         string
	SessionID      string
	Stage          model.TurnFailureStage
	Events         []model.TurnEvent
	PreviousTurnID string
	Metadata       map[string]any
	OutputText     string
	ReasoningText  string
}

type publicAPITurnFailureError struct {
	cause   error
	context publicAPITurnFailureContext
}

func (e *publicAPITurnFailureError) Error() string {
	if e == nil || e.cause == nil {
		return "public api turn failed"
	}
	return e.cause.Error()
}

func (e *publicAPITurnFailureError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.cause
}

type handledTurnExecutionError struct {
	cause error
}

func (e *handledTurnExecutionError) Error() string {
	if e == nil || e.cause == nil {
		return "turn execution failed"
	}
	return e.cause.Error()
}

func (e *handledTurnExecutionError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.cause
}

func wrapPublicAPITurnFailure(
	cause error,
	context publicAPITurnFailureContext,
) error {
	if cause == nil {
		return nil
	}
	return &publicAPITurnFailureError{
		cause:   cause,
		context: context,
	}
}

func wrapHandledTurnExecutionError(cause error) error {
	if cause == nil {
		return nil
	}
	return &handledTurnExecutionError{cause: cause}
}

func unwrapHandledTurnExecutionError(cause error) (error, bool) {
	var handled *handledTurnExecutionError
	if !errors.As(cause, &handled) || handled == nil {
		return cause, false
	}
	return handled.cause, true
}

func extractPublicAPITurnFailureContext(
	cause error,
) (publicAPITurnFailureContext, bool) {
	var failure *publicAPITurnFailureError
	if !errors.As(cause, &failure) || failure == nil {
		return publicAPITurnFailureContext{}, false
	}
	return failure.context, true
}

// BuildPublicTurnFailureEvent keeps every `/v1/turns` failure exit on one wire
// shape so SDKs and UIs can trust the terminal SSE event instead of guessing
// from missing snapshots or transport shutdown timing.
func BuildPublicTurnFailureEvent(
	turnID string,
	stage model.TurnFailureStage,
	cause error,
) model.TurnEvent {
	message := strings.TrimSpace(errorMessageForPublicAPI(cause))
	if message == "" {
		message = "public api invocation failed"
	}
	retryable := publicAPITurnFailureRetryable(cause)
	event := model.TurnEvent{
		Type:      model.TurnEventTurnFailed,
		TurnID:    strings.TrimSpace(turnID),
		Status:    "failed",
		Error:     message,
		Stage:     stage,
		Retryable: &retryable,
		Code:      publicAPITurnFailureCode(cause),
	}
	return event
}

func BuildPublicTurnFailureEventFromError(
	cause error,
	defaultStage model.TurnFailureStage,
) model.TurnEvent {
	context, ok := extractPublicAPITurnFailureContext(cause)
	if ok {
		if context.Stage != "" {
			defaultStage = context.Stage
		}
		return BuildPublicTurnFailureEvent(context.TurnID, defaultStage, cause)
	}
	return BuildPublicTurnFailureEvent("", defaultStage, cause)
}

func buildFailedTurnSnapshotEnvelope(
	invocation *model.PublicAPIInvocation,
	_ string,
	cause error,
) json.RawMessage {
	if invocation == nil {
		return json.RawMessage(`{}`)
	}

	context, hasContext := extractPublicAPITurnFailureContext(cause)
	events := append([]model.TurnEvent(nil), context.Events...)
	if len(events) == 0 {
		stage := model.TurnFailureStageSnapshotBuild
		if hasContext && context.Stage != "" {
			stage = context.Stage
		}
		events = append(events, BuildPublicTurnFailureEvent(invocation.ResponseID, stage, cause))
	}

	outputText := ""
	reasoningText := ""
	metadata := map[string]any(nil)
	previousTurnID := ""
	if hasContext {
		outputText = context.OutputText
		reasoningText = context.ReasoningText
		metadata = context.Metadata
		previousTurnID = context.PreviousTurnID
	}
	sessionID := context.SessionID
	if strings.TrimSpace(sessionID) == "" {
		sessionID = sessionIDFromInvocation(invocation)
	}

	snapshot := buildTurnSnapshot(
		invocation,
		invocation.AgentName,
		sessionID,
		previousTurnID,
		outputText,
		reasoningText,
		nil,
		events,
		metadata,
	)
	payload, err := json.Marshal(snapshot)
	if err != nil {
		return json.RawMessage(`{}`)
	}
	return payload
}

func errorMessageForPublicAPI(cause error) string {
	if cause == nil {
		return ""
	}
	var publicErr *PublicAPIError
	if errors.As(cause, &publicErr) && publicErr != nil {
		return publicErr.Message
	}
	return cause.Error()
}

func publicAPITurnFailureCode(cause error) string {
	var publicErr *PublicAPIError
	if errors.As(cause, &publicErr) && publicErr != nil {
		return strings.TrimSpace(publicErr.Code)
	}
	return "runtime_error"
}

func publicAPITurnFailureRetryable(cause error) bool {
	var publicErr *PublicAPIError
	if errors.As(cause, &publicErr) && publicErr != nil {
		return publicErr.StatusCode == http.StatusTooManyRequests || publicErr.StatusCode >= http.StatusInternalServerError
	}
	return true
}
