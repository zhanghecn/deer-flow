import {
  createPublicAPITurn,
  getPublicAPITurn,
  streamPublicAPITurn,
  type PublicAPITurnRequestBody,
  type PublicAPITurnSnapshot,
  type PublicAPITurnStreamEvent,
} from "./public-api";

export type ToolCallStep = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  output?: Array<{ id?: string; text?: string; type?: string }>;
  status: "running" | "done" | "error";
};

export type ChatSessionPromptParams = {
  text: string;
  stream?: boolean;
  metadata?: Record<string, unknown>;
  signal?: AbortSignal;
  onUpdate?: (update: {
    text: string;
    reasoning: string;
    turnId: string;
    phase: "streaming" | "ready" | "failed";
  }) => void;
  onToolCall?: (tool: ToolCallStep) => void;
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

function buildRequestBody(params: {
  agent: string;
  previousTurnId: string;
  prompt: ChatSessionPromptParams;
}): PublicAPITurnRequestBody {
  return {
    agent: params.agent,
    input: { text: params.prompt.text },
    previous_turn_id: params.previousTurnId || undefined,
    stream: params.prompt.stream ?? true,
    metadata: params.prompt.metadata,
    thinking: { enabled: true, effort: "high" },
  };
}

export function createChatSession(params: {
  baseURL: string;
  apiToken: string;
  agent: string;
  previousTurnId?: string;
}): ChatSession {
  let previousTurnId = params.previousTurnId?.trim() ?? "";

  return {
    async prompt(promptParams) {
      const requestBody = buildRequestBody({
        agent: params.agent,
        previousTurnId,
        prompt: promptParams,
      });

      if (requestBody.stream === false) {
        const turn = await createPublicAPITurn({
          baseURL: params.baseURL,
          apiToken: params.apiToken,
          body: requestBody,
          signal: promptParams.signal,
        });
        previousTurnId = turn.id;
        return { turn };
      }

      let accumulatedOutput = "";
      let accumulatedReasoning = "";
      let currentTurnId = "";
      const toolCalls = new Map<string, ToolCallStep>();

      await streamPublicAPITurn({
        baseURL: params.baseURL,
        apiToken: params.apiToken,
        body: requestBody,
        signal: promptParams.signal,
        onEvent: (event: PublicAPITurnStreamEvent) => {
          const data = event.data as Record<string, unknown> | null;
          if (!data || typeof data !== "object") return;

          const eventType = String(data.type ?? "");
          // Keep event-specific streaming side effects in one table so the
          // shared update below can stay small and behaviorally stable.
          const eventHandlers: Record<
            string,
            (eventData: Record<string, unknown>) => void
          > = {
            "assistant.text.delta": (eventData) => {
              if (typeof eventData.delta === "string") {
                accumulatedOutput += eventData.delta;
              }
            },
            "assistant.reasoning.delta": (eventData) => {
              if (typeof eventData.delta !== "string") return;
              accumulatedReasoning += eventData.delta;
              promptParams.onUpdate?.({
                text: accumulatedOutput,
                reasoning: accumulatedReasoning,
                turnId: currentTurnId,
                phase: "streaming",
              });
            },
            "turn.started": (eventData) => {
              if (typeof eventData.turn_id === "string") {
                currentTurnId = eventData.turn_id;
              }
            },
            "turn.completed": (eventData) => {
              if (typeof eventData.turn_id === "string") {
                currentTurnId = eventData.turn_id;
              }
            },
            "tool.call.started": (eventData) => {
              const toolCallId = String(eventData.tool_call_id ?? "");
              const toolName = String(eventData.tool_name ?? "");
              const toolArgs =
                eventData.tool_arguments &&
                typeof eventData.tool_arguments === "object"
                  ? (eventData.tool_arguments as Record<string, unknown>)
                  : {};
              if (toolCallId && toolName) {
                const step: ToolCallStep = {
                  id: toolCallId,
                  name: toolName,
                  arguments: toolArgs,
                  status: "running",
                };
                toolCalls.set(toolCallId, step);
                promptParams.onToolCall?.(step);
              }
            },
            "tool.call.completed": (eventData) => {
              const toolCallId = String(eventData.tool_call_id ?? "");
              const toolName = String(eventData.tool_name ?? "");
              const toolOutput = Array.isArray(eventData.tool_output)
                ? (eventData.tool_output as Array<{
                    id?: string;
                    text?: string;
                    type?: string;
                  }>)
                : [];
              if (toolCallId) {
                const existing = toolCalls.get(toolCallId);
                const step: ToolCallStep = {
                  id: toolCallId,
                  name: existing?.name ?? toolName,
                  arguments: existing?.arguments ?? {},
                  output: toolOutput,
                  status: "done",
                };
                toolCalls.set(toolCallId, step);
                promptParams.onToolCall?.(step);
              }
            },
          };
          const handler = eventHandlers[eventType];
          handler?.(data);

          const phase: "streaming" | "ready" | "failed" =
            eventType === "turn.failed"
              ? "failed"
              : eventType === "turn.completed"
                ? "ready"
                : "streaming";

          promptParams.onUpdate?.({
            text: accumulatedOutput,
            reasoning: accumulatedReasoning,
            turnId: currentTurnId,
            phase,
          });
        },
      });

      if (!currentTurnId) {
        return { turn: null };
      }

      const turn = await getPublicAPITurn({
        baseURL: params.baseURL,
        apiToken: params.apiToken,
        turnId: currentTurnId,
        signal: promptParams.signal,
      });

      previousTurnId = turn.id;
      return { turn };
    },
    reset() {
      previousTurnId = "";
    },
    getPreviousTurnId() {
      return previousTurnId;
    },
  };
}
