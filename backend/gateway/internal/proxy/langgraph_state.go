package proxy

import (
	"bytes"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
)

var langGraphFrontendStateKeys = map[string]struct{}{
	"__interrupt__": {},
	"artifacts":     {},
	"messages":      {},
	"title":         {},
	"todos":         {},
}

var langGraphMessageFields = []string{
	"id",
	"type",
	"name",
	"tool_call_id",
	"status",
}

var langGraphToolCallFields = []string{
	"id",
	"name",
}

var langGraphDroppableToolMessages = map[string]struct{}{
	"bash":        {},
	"edit":        {},
	"edit_file":   {},
	"execute":     {},
	"glob":        {},
	"grep":        {},
	"ls":          {},
	"multiedit":   {},
	"read":        {},
	"read_file":   {},
	"todoread":    {},
	"todowrite":   {},
	"write_file":  {},
	"write_todos": {},
	"str_replace": {},
}

var langGraphReasoningKeys = map[string]struct{}{
	"thinking":          {},
	"reasoning":         {},
	"reasoning_content": {},
}

var langGraphTruncatedToolArgKeys = map[string]struct{}{
	"content":    {},
	"old_string": {},
	"new_string": {},
	"oldString":  {},
	"newString":  {},
}

var langGraphPassthroughToolContent = map[string]struct{}{
	"image_search": {},
	"task":         {},
	"web_search":   {},
}

const (
	langGraphHistoryReasoningLimit = 4000
	langGraphHistoryTextLimit      = 16000
	langGraphHistoryToolArgLimit   = 20000
	langGraphHistoryTurnTailLimit  = 12
	langGraphHistoryTruncationNote = "\n...[truncated for history]"
)

func maybeTransformLangGraphHistoryResponse(resp *http.Response) {
	if resp == nil || resp.Body == nil || resp.Request == nil || resp.Request.URL == nil {
		return
	}

	path := resp.Request.URL.Path
	if !strings.HasSuffix(path, "/history") {
		return
	}

	contentType := strings.ToLower(strings.TrimSpace(resp.Header.Get("Content-Type")))
	if contentType != "" && !strings.Contains(contentType, "application/json") {
		return
	}

	originalBody := resp.Body
	raw, err := io.ReadAll(originalBody)
	if err != nil {
		log.Printf("[proxy][langgraph-history] failed to read upstream history body: %v", err)
		return
	}
	_ = originalBody.Close()

	transformed, changed, err := transformLangGraphHistoryPayload(raw)
	if err != nil {
		log.Printf("[proxy][langgraph-history] failed to transform history payload: %v", err)
		setLangGraphResponseBody(resp, raw)
		return
	}
	if !changed {
		setLangGraphResponseBody(resp, raw)
		return
	}

	setLangGraphResponseBody(resp, transformed)
}

func transformLangGraphHistoryPayload(payload []byte) ([]byte, bool, error) {
	var states []map[string]any
	if err := json.Unmarshal(payload, &states); err != nil {
		return nil, false, err
	}

	changed := false
	for _, state := range states {
		valuesRaw, ok := state["values"]
		if !ok {
			continue
		}

		values, ok := valuesRaw.(map[string]any)
		if !ok {
			continue
		}

		event := values["_summarization_event"]
		if event == nil {
			event = state["_summarization_event"]
		}

		filtered, filteredChanged := filterLangGraphStateValues(values, event)
		if !filteredChanged {
			continue
		}
		state["values"] = filtered
		changed = true
	}

	if !changed {
		return payload, false, nil
	}

	encoded, err := json.Marshal(states)
	if err != nil {
		return nil, false, err
	}
	return encoded, true, nil
}

func setLangGraphResponseBody(resp *http.Response, body []byte) {
	resp.Body = io.NopCloser(bytes.NewReader(body))
	resp.ContentLength = int64(len(body))
	resp.Header.Set("Content-Length", strconv.Itoa(len(body)))
}

func filterLangGraphStateValues(values map[string]any, event any) (map[string]any, bool) {
	filtered := make(map[string]any, len(langGraphFrontendStateKeys))
	changed := false

	for key, value := range values {
		if key == "messages" {
			messages, compacted := compactLangGraphMessages(value, event)
			filtered[key] = messages
			changed = changed || compacted
			continue
		}

		if _, allowed := langGraphFrontendStateKeys[key]; allowed {
			filtered[key] = value
			continue
		}

		changed = true
	}

	return filtered, changed
}

func copyLangGraphFields(source map[string]any, filtered map[string]any, keys []string) {
	for _, key := range keys {
		if value, ok := source[key]; ok {
			filtered[key] = value
		}
	}
}

func removedLangGraphFields(source map[string]any, filtered map[string]any) bool {
	for key := range source {
		if _, ok := filtered[key]; !ok {
			return true
		}
	}
	return false
}

func compactLangGraphMessages(messages any, event any) (any, bool) {
	messageList, ok := messages.([]any)
	if !ok {
		return messages, false
	}

	compactedMessages, compacted := compactLangGraphMessagesForSummary(messageList, event)
	sanitizedMessages, sanitized := sanitizeLangGraphMessages(compactedMessages)
	compactedTurns, turnCompacted := compactLangGraphHistoryTurns(sanitizedMessages)
	return compactedTurns, compacted || sanitized || turnCompacted
}

func compactLangGraphMessagesForSummary(messageList []any, event any) ([]any, bool) {
	eventMap, ok := event.(map[string]any)
	if !ok {
		return messageList, false
	}

	summaryMessage, ok := eventMap["summary_message"]
	if !ok || summaryMessage == nil {
		return messageList, false
	}

	cutoff, ok := parseJSONInt(eventMap["cutoff_index"])
	if !ok || cutoff <= 0 {
		return messageList, false
	}

	if cutoff > len(messageList) {
		cutoff = len(messageList)
	}

	compacted := make([]any, 0, len(messageList)-cutoff+1)
	compacted = append(compacted, summaryMessage)
	compacted = append(compacted, messageList[cutoff:]...)
	return compacted, true
}

func sanitizeLangGraphMessages(messages []any) ([]any, bool) {
	sanitized := make([]any, 0, len(messages))
	changed := false

	for _, message := range messages {
		messageMap, ok := message.(map[string]any)
		if !ok {
			sanitized = append(sanitized, message)
			continue
		}

		sanitizedMessage, keep, messageChanged := sanitizeLangGraphMessage(messageMap)
		if !keep {
			changed = true
			continue
		}

		sanitized = append(sanitized, sanitizedMessage)
		changed = changed || messageChanged
	}

	return sanitized, changed
}

func compactLangGraphHistoryTurns(messages []any) ([]any, bool) {
	if len(messages) == 0 {
		return messages, false
	}

	prefix, turns := splitLangGraphHistoryTurns(messages)
	if len(turns) == 0 {
		return messages, false
	}

	compacted := make([]any, 0, len(messages))
	compacted = append(compacted, prefix...)
	changed := len(prefix) != 0

	lastTurnIndex := len(turns) - 1
	for index, turn := range turns {
		var nextTurn []any
		var turnChanged bool

		if shouldPreserveLangGraphTurn(turn) {
			nextTurn = turn
		} else if index == lastTurnIndex {
			nextTurn, turnChanged = compactLangGraphActiveTurn(turn)
		} else {
			nextTurn, turnChanged = compactLangGraphCompletedTurn(turn)
		}

		compacted = append(compacted, nextTurn...)
		changed = changed || turnChanged
	}

	if !changed {
		return messages, false
	}

	return compacted, true
}

func splitLangGraphHistoryTurns(messages []any) ([]any, [][]any) {
	prefix := make([]any, 0)
	turns := make([][]any, 0)
	currentTurn := make([]any, 0)
	inTurn := false

	for _, message := range messages {
		messageMap, ok := message.(map[string]any)
		if !ok {
			if inTurn {
				currentTurn = append(currentTurn, message)
			} else {
				prefix = append(prefix, message)
			}
			continue
		}

		if langGraphMessageType(messageMap) == "human" {
			if inTurn {
				turns = append(turns, currentTurn)
			}
			currentTurn = []any{message}
			inTurn = true
			continue
		}

		if inTurn {
			currentTurn = append(currentTurn, message)
			continue
		}

		prefix = append(prefix, message)
	}

	if inTurn {
		turns = append(turns, currentTurn)
	}

	return prefix, turns
}

func shouldPreserveLangGraphTurn(turn []any) bool {
	for _, message := range turn {
		messageMap, ok := message.(map[string]any)
		if !ok {
			continue
		}
		if langGraphMessageType(messageMap) != "tool" {
			continue
		}
		if messageMap["name"] == "ask_clarification" {
			return true
		}
	}
	return false
}

func compactLangGraphCompletedTurn(turn []any) ([]any, bool) {
	if len(turn) <= 2 {
		return turn, false
	}

	compacted := []any{turn[0]}
	for index := 1; index < len(turn); index++ {
		messageMap, ok := turn[index].(map[string]any)
		if ok && shouldKeepLangGraphDisplayMessage(messageMap) {
			compacted = append(compacted, turn[index])
		}
	}

	if len(compacted) == 1 {
		fallbackStart := normalizeLangGraphTurnWindowStart(turn, maxInt(1, len(turn)-2))
		compacted = append(compacted, turn[fallbackStart:]...)
	}

	if len(compacted) == len(turn) {
		return turn, false
	}

	return compacted, true
}

func compactLangGraphActiveTurn(turn []any) ([]any, bool) {
	if len(turn) <= langGraphHistoryTurnTailLimit+1 {
		return turn, false
	}

	windowStart := normalizeLangGraphTurnWindowStart(turn, len(turn)-langGraphHistoryTurnTailLimit)
	keepIndexes := make(map[int]struct{}, len(turn)-windowStart+1)
	keepIndexes[0] = struct{}{}

	for index := windowStart; index < len(turn); index++ {
		keepIndexes[index] = struct{}{}
	}

	for index := 1; index < len(turn); index++ {
		messageMap, ok := turn[index].(map[string]any)
		if !ok {
			continue
		}
		if shouldKeepLangGraphDisplayMessage(messageMap) {
			keepIndexes[index] = struct{}{}
		}
	}

	compacted := make([]any, 0, len(keepIndexes))
	for index, message := range turn {
		if _, ok := keepIndexes[index]; ok {
			compacted = append(compacted, message)
		}
	}

	if len(compacted) == len(turn) {
		return turn, false
	}

	return compacted, true
}

func normalizeLangGraphTurnWindowStart(turn []any, start int) int {
	if start <= 1 {
		return 1
	}
	if start >= len(turn) {
		return len(turn) - 1
	}

	for start > 1 {
		messageMap, ok := turn[start].(map[string]any)
		if !ok {
			return start
		}
		if langGraphMessageType(messageMap) != "tool" {
			return start
		}
		start--
	}

	return start
}

func shouldKeepLangGraphDisplayMessage(message map[string]any) bool {
	if langGraphMessageType(message) != "ai" {
		return false
	}
	if hasLangGraphPresentFilesToolCall(message) {
		return true
	}
	if hasLangGraphToolCalls(message) {
		return false
	}
	return hasLangGraphRenderableContent(message["content"])
}

func hasLangGraphPresentFilesToolCall(message map[string]any) bool {
	toolCalls, ok := message["tool_calls"].([]any)
	if !ok {
		return false
	}

	for _, item := range toolCalls {
		toolCall, ok := item.(map[string]any)
		if !ok {
			continue
		}
		if toolCall["name"] == "present_files" {
			return true
		}
	}

	return false
}

func hasLangGraphToolCalls(message map[string]any) bool {
	toolCalls, ok := message["tool_calls"].([]any)
	return ok && len(toolCalls) > 0
}

func hasLangGraphRenderableContent(content any) bool {
	switch typed := content.(type) {
	case string:
		return strings.TrimSpace(typed) != ""
	case []any:
		for _, item := range typed {
			block, ok := item.(map[string]any)
			if !ok {
				continue
			}
			blockType, _ := block["type"].(string)
			if blockType != "" && blockType != "text" && blockType != "image_url" {
				continue
			}
			for _, key := range []string{"text", "image_url"} {
				switch value := block[key].(type) {
				case string:
					if strings.TrimSpace(value) != "" {
						return true
					}
				case map[string]any:
					if url, ok := value["url"].(string); ok && strings.TrimSpace(url) != "" {
						return true
					}
				}
			}
		}
	}
	return false
}

func langGraphMessageType(message map[string]any) string {
	messageType, _ := message["type"].(string)
	return messageType
}

func sanitizeLangGraphMessage(message map[string]any) (map[string]any, bool, bool) {
	if shouldDropLangGraphToolMessage(message) {
		return nil, false, true
	}

	filtered := make(map[string]any, 8)
	changed := false

	copyLangGraphFields(message, filtered, langGraphMessageFields)
	if value, ok := message["content"]; ok {
		sanitizedContent, contentChanged := sanitizeLangGraphMessageContent(message, value)
		filtered["content"] = sanitizedContent
		changed = changed || contentChanged
	}
	if value, ok := message["tool_calls"]; ok {
		sanitizedToolCalls, toolCallsChanged := sanitizeLangGraphToolCalls(value)
		filtered["tool_calls"] = sanitizedToolCalls
		changed = changed || toolCallsChanged
	}
	if value, ok := message["additional_kwargs"]; ok {
		sanitizedKwargs, keepKwargs, kwargsChanged := sanitizeLangGraphAdditionalKwargs(value)
		if keepKwargs {
			filtered["additional_kwargs"] = sanitizedKwargs
		}
		changed = changed || kwargsChanged
	}

	changed = changed || removedLangGraphFields(message, filtered)

	return filtered, true, changed
}

func shouldDropLangGraphToolMessage(message map[string]any) bool {
	messageType, _ := message["type"].(string)
	if messageType != "tool" {
		return false
	}

	name, _ := message["name"].(string)
	_, drop := langGraphDroppableToolMessages[name]
	return drop
}

func sanitizeLangGraphMessageContent(message map[string]any, content any) (any, bool) {
	messageType, _ := message["type"].(string)
	messageName, _ := message["name"].(string)

	if messageType == "tool" && shouldKeepLangGraphToolContent(messageName) {
		return content, false
	}

	switch typed := content.(type) {
	case string:
		return truncateLangGraphString(typed, langGraphHistoryTextLimit)
	case []any:
		sanitized := make([]any, 0, len(typed))
		changed := false
		for _, block := range typed {
			blockMap, ok := block.(map[string]any)
			if !ok {
				sanitized = append(sanitized, block)
				continue
			}

			sanitizedBlock, blockChanged := sanitizeLangGraphContentBlock(blockMap)
			sanitized = append(sanitized, sanitizedBlock)
			changed = changed || blockChanged
		}
		return sanitized, changed
	default:
		return content, false
	}
}

func sanitizeLangGraphContentBlock(block map[string]any) (map[string]any, bool) {
	filtered := make(map[string]any, len(block))
	changed := false
	blockType, _ := block["type"].(string)
	isReasoningBlock := blockType == "thinking" || blockType == "reasoning"

	for key, value := range block {
		if key == "signature" {
			changed = true
			continue
		}

		text, ok := value.(string)
		if !ok {
			filtered[key] = value
			continue
		}

		limit := resolveLangGraphContentLimit(key, isReasoningBlock)
		truncatedText, truncated := truncateLangGraphString(text, limit)
		filtered[key] = truncatedText
		changed = changed || truncated
	}

	return filtered, changed
}

func sanitizeLangGraphToolCalls(toolCalls any) (any, bool) {
	toolCallList, ok := toolCalls.([]any)
	if !ok {
		return toolCalls, false
	}

	sanitized := make([]any, 0, len(toolCallList))
	changed := false

	for _, toolCall := range toolCallList {
		toolCallMap, ok := toolCall.(map[string]any)
		if !ok {
			sanitized = append(sanitized, toolCall)
			continue
		}

		filtered := make(map[string]any, 3)
		copyLangGraphFields(toolCallMap, filtered, langGraphToolCallFields)
		if value, ok := toolCallMap["args"]; ok {
			sanitizedArgs, argsChanged := sanitizeLangGraphToolCallArgs(value)
			filtered["args"] = sanitizedArgs
			changed = changed || argsChanged
		}

		changed = changed || removedLangGraphFields(toolCallMap, filtered)

		sanitized = append(sanitized, filtered)
	}

	return sanitized, changed
}

func sanitizeLangGraphToolCallArgs(args any) (any, bool) {
	argsMap, ok := args.(map[string]any)
	if !ok {
		return args, false
	}

	filtered := make(map[string]any, len(argsMap))
	changed := false
	for key, value := range argsMap {
		text, ok := value.(string)
		if !ok {
			filtered[key] = value
			continue
		}

		if !shouldTruncateLangGraphToolArg(key) {
			filtered[key] = text
			continue
		}

		truncatedText, truncated := truncateLangGraphString(text, langGraphHistoryToolArgLimit)
		filtered[key] = truncatedText
		changed = changed || truncated
	}

	return filtered, changed
}

func shouldTruncateLangGraphToolArg(key string) bool {
	_, ok := langGraphTruncatedToolArgKeys[key]
	return ok
}

func sanitizeLangGraphAdditionalKwargs(kwargs any) (map[string]any, bool, bool) {
	kwargsMap, ok := kwargs.(map[string]any)
	if !ok {
		return nil, false, false
	}

	filtered := make(map[string]any, 3)
	changed := false

	if value, ok := kwargsMap["files"]; ok {
		filtered["files"] = value
	}
	if value, ok := kwargsMap["element"]; ok {
		filtered["element"] = value
	}
	if value, ok := kwargsMap["reasoning_content"].(string); ok {
		truncatedText, truncated := truncateLangGraphString(value, langGraphHistoryReasoningLimit)
		filtered["reasoning_content"] = truncatedText
		changed = changed || truncated
	}

	for key := range kwargsMap {
		if _, ok := filtered[key]; !ok {
			changed = true
		}
	}

	return filtered, len(filtered) > 0, changed
}

func shouldKeepLangGraphToolContent(toolName string) bool {
	_, ok := langGraphPassthroughToolContent[toolName]
	return ok
}

func resolveLangGraphContentLimit(key string, isReasoningBlock bool) int {
	if _, ok := langGraphReasoningKeys[key]; ok {
		return langGraphHistoryReasoningLimit
	}
	if key == "text" && isReasoningBlock {
		return langGraphHistoryReasoningLimit
	}
	return langGraphHistoryTextLimit
}

func truncateLangGraphString(value string, limit int) (string, bool) {
	if limit <= 0 {
		if value == "" {
			return value, false
		}
		return langGraphHistoryTruncationNote, true
	}

	runes := []rune(value)
	if len(runes) <= limit {
		return value, false
	}

	return string(runes[:limit]) + langGraphHistoryTruncationNote, true
}

func parseJSONInt(value any) (int, bool) {
	switch typed := value.(type) {
	case int:
		return typed, true
	case int32:
		return int(typed), true
	case int64:
		return int(typed), true
	case float64:
		return int(typed), true
	default:
		return 0, false
	}
}

func maxInt(a int, b int) int {
	if a > b {
		return a
	}
	return b
}
