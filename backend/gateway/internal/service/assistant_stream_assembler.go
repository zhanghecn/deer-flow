package service

import (
	"fmt"
	"strings"
	"unicode"
)

type assistantStreamAssembler struct {
	lastTextByMsgID      map[string]string
	lastReasoningByMsgID map[string]string
	emittedReasoningText string
}

func newAssistantStreamAssembler() assistantStreamAssembler {
	return assistantStreamAssembler{
		lastTextByMsgID:      make(map[string]string),
		lastReasoningByMsgID: make(map[string]string),
	}
}

func assistantMessageID(record map[string]any) string {
	if messageID := strings.TrimSpace(fmt.Sprint(record["id"])); messageID != "" && messageID != "<nil>" {
		return messageID
	}
	// LangGraph chunks can omit ids while replaying cumulative content for the
	// same assistant turn. A stable fallback lets the assembler convert those
	// snapshots into monotonic deltas instead of treating every chunk as a new
	// completed message.
	return "assistant:stream"
}

func (a *assistantStreamAssembler) textDelta(messageID string, content any) string {
	current := extractMessageChunkTextDelta(content)
	return a.deltaForMessage(a.lastTextByMsgID, messageID, current)
}

func (a *assistantStreamAssembler) reasoningDelta(messageID string, content any) string {
	current := extractReasoningFromContentBlocks(content)
	delta := a.deltaForMessage(a.lastReasoningByMsgID, messageID, current)
	return a.filterReasoningDelta(delta)
}

func (a *assistantStreamAssembler) deltaForMessage(state map[string]string, messageID string, current string) string {
	if strings.TrimSpace(current) == "" {
		return ""
	}
	previous := state[messageID]
	switch {
	case previous == "":
		state[messageID] = current
		return current
	case current == previous:
		return ""
	case strings.HasPrefix(current, previous):
		delta := current[len(previous):]
		state[messageID] = current
		return delta
	case strings.HasPrefix(previous, current):
		// Some runtime streams replay an earlier cumulative prefix after tool or
		// state updates. Drop it so the public stream remains append-only.
		return ""
	case compactStreamText(current) == compactStreamText(previous):
		// Final LangGraph snapshots can replay the full assistant answer with
		// provider-normalized spacing that differs from the token deltas. Treat
		// that as the same cumulative text so SDK consumers do not append it twice.
		state[messageID] = current
		return ""
	case strings.HasPrefix(compactStreamText(current), compactStreamText(previous)):
		delta := textAfterCompactPrefix(current, compactStreamText(previous))
		if strings.TrimSpace(delta) == "" {
			state[messageID] = current
			return ""
		}
		state[messageID] = current
		return delta
	case strings.HasPrefix(compactStreamText(previous), compactStreamText(current)):
		return ""
	default:
		// Providers can switch between token deltas and cumulative chunks for the
		// same message. Preserve the visible token while updating the synthetic
		// accumulated state so a later full replay can still be suppressed.
		state[messageID] = previous + current
		return current
	}
}

func (a *assistantStreamAssembler) filterReasoningDelta(delta string) string {
	trimmed := strings.TrimSpace(delta)
	if trimmed == "" {
		return ""
	}
	// Reasoning is frequently replayed under a fresh LangGraph message id after
	// tool boundaries. Keep small token deltas, but suppress repeated paragraph
	// snapshots so SDK/UI consumers see one growing reasoning stream.
	if len([]rune(trimmed)) >= 24 && strings.Contains(a.emittedReasoningText, trimmed) {
		return ""
	}
	a.emittedReasoningText += delta
	return delta
}

func compactStreamText(value string) string {
	var builder strings.Builder
	for _, r := range value {
		if unicode.IsSpace(r) {
			continue
		}
		builder.WriteRune(r)
	}
	return builder.String()
}

func textAfterCompactPrefix(value string, compactPrefix string) string {
	if compactPrefix == "" {
		return value
	}
	consumed := 0
	for index, r := range value {
		if unicode.IsSpace(r) {
			continue
		}
		if consumed >= len(compactPrefix) {
			return value[index:]
		}
		consumed += len(string(r))
		if consumed == len(compactPrefix) {
			return value[index+len(string(r)):]
		}
	}
	return ""
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
