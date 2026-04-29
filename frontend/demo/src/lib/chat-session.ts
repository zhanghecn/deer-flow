import type { PublicAPITurnSnapshot } from "./public-api";
import { mergeStreamingText } from "./public-api-run-session";
import { createPublicAPISession } from "./public-api-session";
import {
  normalizeThreadError,
  shouldIgnoreThreadError,
} from "./thread-error";

export type ToolCallStep = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  output?: Array<{ id?: string; text?: string; type?: string }>;
  status: "running" | "done" | "error";
};

export type ChatActivityStep =
  | {
      id: string;
      kind: "reasoning";
      text: string;
      status: "running" | "done";
    }
  | {
      id: string;
      kind: "tool";
      tool: ToolCallStep;
    };

export type ChatSessionPromptParams = {
  text: string;
  fileIds?: string[];
  stream?: boolean;
  metadata?: Record<string, unknown>;
  signal?: AbortSignal;
  onUpdate?: (update: {
    text: string;
    reasoning: string;
    error?: string;
    turnId: string;
    phase: "streaming" | "waiting" | "ready" | "failed" | "interrupted";
  }) => void;
  onToolCall?: (tool: ToolCallStep) => void;
  onActivity?: (activity: ChatActivityStep) => void;
};

export type ChatSessionPromptResult = {
  turn: PublicAPITurnSnapshot | null;
};

export type ChatSession = {
  prompt: (
    params: ChatSessionPromptParams,
  ) => Promise<ChatSessionPromptResult>;
  reset: () => void;
  getPreviousTurnId: () => string;
};

function normalizeToolOutput(output: unknown): Array<{
  id?: string;
  text?: string;
  type?: string;
}> {
  if (Array.isArray(output)) {
    return output.map((item) => {
      if (!item || typeof item !== "object") {
        return {
          type: typeof item === "string" ? "text" : "json",
          text:
            typeof item === "string" ? item : JSON.stringify(item, null, 2),
        };
      }
      const record = item as Record<string, unknown>;
      return {
        id: typeof record.id === "string" ? record.id : undefined,
        type: typeof record.type === "string" ? record.type : undefined,
        text:
          typeof record.text === "string"
            ? record.text
            : JSON.stringify(record, null, 2),
      };
    });
  }
  if (output === undefined) {
    return [];
  }
  return [
    {
      type: typeof output === "string" ? "text" : "json",
      text:
        typeof output === "string" ? output : JSON.stringify(output, null, 2),
    },
  ];
}

export function createChatSession(params: {
  baseURL: string;
  apiToken: string;
  agent: string;
  previousTurnId?: string;
}): ChatSession {
  const session = createPublicAPISession({
    baseURL: params.baseURL,
    apiToken: params.apiToken,
    agent: params.agent,
    previousTurnId: params.previousTurnId,
  });

  return {
    async prompt(promptParams) {
      const toolCalls = new Map<string, ToolCallStep>();
      const reasoningSegments = new Map<string, string>();
      let latestText = "";
      let latestReasoning = "";
      let latestTurnId = "";
      let latestError = "";
      let activitySequence = 0;
      let currentReasoningActivityId = "";

      const nextActivityId = (prefix: string) => {
        activitySequence += 1;
        return `${prefix}-${activitySequence}`;
      };

      try {
        const result = await session.prompt({
          text: promptParams.text,
          fileIds: promptParams.fileIds,
          stream: promptParams.stream,
          metadata: promptParams.metadata,
          signal: promptParams.signal,
          thinking: { enabled: true, effort: "high" },
          onUpdate: ({ event, readModel }) => {
            latestText = readModel.liveOutput;
            latestReasoning = readModel.liveReasoning;
            latestTurnId = readModel.turnId;

            if (event.kind === "turn_failed") {
              latestError = normalizeThreadError(event.raw);
            }

            if (event.kind === "assistant_reasoning_delta" && event.delta) {
              if (!currentReasoningActivityId) {
                currentReasoningActivityId = nextActivityId("reasoning");
              }
              const previousSegment =
                reasoningSegments.get(currentReasoningActivityId) ?? "";
              const nextSegment = mergeStreamingText(
                previousSegment,
                event.delta,
              );
              reasoningSegments.set(currentReasoningActivityId, nextSegment);
              promptParams.onActivity?.({
                id: currentReasoningActivityId,
                kind: "reasoning",
                text: nextSegment,
                status: "running",
              });
            }

            if (event.kind === "ledger_event") {
              if (event.event.type === "turn.failed") {
                latestError = normalizeThreadError(event.event);
              }

              if (
                event.event.type === "tool.call.started" &&
                event.event.tool_call_id &&
                event.event.tool_name
              ) {
                const tool: ToolCallStep = {
                  id: event.event.tool_call_id,
                  name: event.event.tool_name,
                  arguments:
                    event.event.tool_arguments &&
                    typeof event.event.tool_arguments === "object"
                      ? (event.event.tool_arguments as Record<string, unknown>)
                      : {},
                  status: "running",
                };
                toolCalls.set(tool.id, tool);
                // A tool boundary closes the current visible reasoning segment
                // so later thinking appears after the tool, matching SSE order.
                currentReasoningActivityId = "";
                promptParams.onToolCall?.(tool);
                promptParams.onActivity?.({
                  id: tool.id,
                  kind: "tool",
                  tool,
                });
              }

              if (
                event.event.type === "tool.call.completed" &&
                event.event.tool_call_id
              ) {
                const existing = toolCalls.get(event.event.tool_call_id);
                const tool: ToolCallStep = {
                  id: event.event.tool_call_id,
                  name: existing?.name ?? event.event.tool_name ?? "unknown",
                  arguments: existing?.arguments ?? {},
                  output: normalizeToolOutput(event.event.tool_output),
                  status: "done",
                };
                toolCalls.set(tool.id, tool);
                promptParams.onToolCall?.(tool);
                promptParams.onActivity?.({
                  id: tool.id,
                  kind: "tool",
                  tool,
                });
              }
            }

            promptParams.onUpdate?.({
              text: latestText,
              reasoning: latestReasoning,
              error: latestError || undefined,
              turnId: latestTurnId,
              phase: readModel.phase,
            });
          },
        });

        if (
          result.turn?.status === "failed" &&
          !latestError &&
          Array.isArray(result.turn.events)
        ) {
          const failedEvent = result.turn.events.find(
            (event) => event.type === "turn.failed",
          );
          latestError = failedEvent ? normalizeThreadError(failedEvent) : "";
        }

        return { turn: result.turn };
      } catch (error) {
        if (shouldIgnoreThreadError(error)) {
          promptParams.onUpdate?.({
            text: latestText,
            reasoning: latestReasoning,
            error: undefined,
            turnId: latestTurnId,
            phase: "interrupted",
          });
        }
        throw error;
      }
    },
    reset() {
      session.reset();
    },
    getPreviousTurnId() {
      return session.getPreviousTurnId();
    },
  };
}
