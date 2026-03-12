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

const (
	langGraphHistoryReasoningLimit = 4000
	langGraphHistoryTextLimit      = 16000
	langGraphHistoryToolArgLimit   = 20000
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
		resp.Body = io.NopCloser(bytes.NewReader(raw))
		resp.ContentLength = int64(len(raw))
		resp.Header.Set("Content-Length", strconv.Itoa(len(raw)))
		return
	}
	if !changed {
		resp.Body = io.NopCloser(bytes.NewReader(raw))
		resp.ContentLength = int64(len(raw))
		resp.Header.Set("Content-Length", strconv.Itoa(len(raw)))
		return
	}

	resp.Body = io.NopCloser(bytes.NewReader(transformed))
	resp.ContentLength = int64(len(transformed))
	resp.Header.Set("Content-Length", strconv.Itoa(len(transformed)))
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

func compactLangGraphMessages(messages any, event any) (any, bool) {
	messageList, ok := messages.([]any)
	if !ok {
		return messages, false
	}

	compactedMessages, compacted := compactLangGraphMessagesForSummary(messageList, event)
	sanitizedMessages, sanitized := sanitizeLangGraphMessages(compactedMessages)
	return sanitizedMessages, compacted || sanitized
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

func sanitizeLangGraphMessage(message map[string]any) (map[string]any, bool, bool) {
	if shouldDropLangGraphToolMessage(message) {
		return nil, false, true
	}

	filtered := make(map[string]any, 8)
	changed := false

	if value, ok := message["id"]; ok {
		filtered["id"] = value
	}
	if value, ok := message["type"]; ok {
		filtered["type"] = value
	}
	if value, ok := message["name"]; ok {
		filtered["name"] = value
	}
	if value, ok := message["tool_call_id"]; ok {
		filtered["tool_call_id"] = value
	}
	if value, ok := message["status"]; ok {
		filtered["status"] = value
	}
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

	for key := range message {
		if _, ok := filtered[key]; !ok {
			changed = true
		}
	}

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

	if messageType == "tool" && (messageName == "web_search" || messageName == "image_search" || messageName == "task") {
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

		limit := langGraphHistoryTextLimit
		if key == "thinking" || key == "reasoning" || key == "reasoning_content" || (key == "text" && isReasoningBlock) {
			limit = langGraphHistoryReasoningLimit
		}

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
		if value, ok := toolCallMap["id"]; ok {
			filtered["id"] = value
		}
		if value, ok := toolCallMap["name"]; ok {
			filtered["name"] = value
		}
		if value, ok := toolCallMap["args"]; ok {
			sanitizedArgs, argsChanged := sanitizeLangGraphToolCallArgs(value)
			filtered["args"] = sanitizedArgs
			changed = changed || argsChanged
		}

		for key := range toolCallMap {
			if _, ok := filtered[key]; !ok {
				changed = true
			}
		}

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
	switch key {
	case "content", "old_string", "new_string", "oldString", "newString":
		return true
	default:
		return false
	}
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
