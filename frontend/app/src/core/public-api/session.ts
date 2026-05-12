import {
  createPublicAPITurn,
  type PublicAPIReasoningEffort,
  type PublicAPITurnRequestBody,
  type PublicAPITurnSnapshot,
} from "./api";
import {
  applyPublicAPITurnSnapshot,
  createPublicAPIRunReadModel,
  type PublicAPIRunReadModel,
} from "./run-session";
import {
  runStreamedPublicAPITurn,
  type PublicAPITurnStreamUpdate,
} from "./turn-runner";
import {
  createPublicAPISDKMessageProjector,
  type PublicAPISDKMessage,
  type PublicAPISDKMessageUpdate,
} from "./sdk-messages";

export type PublicAPISessionPromptParams = {
  text: string;
  fileIds?: string[];
  stream?: boolean;
  metadata?: Record<string, unknown>;
  thinking?: {
    enabled: boolean;
    effort?: PublicAPIReasoningEffort;
  };
  textOptions?: PublicAPITurnRequestBody["text"];
  maxOutputTokens?: number;
  signal?: AbortSignal;
  includePartialMessages?: boolean;
  onUpdate?: (update: PublicAPITurnStreamUpdate) => void;
  onMessage?: (update: PublicAPISDKMessageUpdate) => void;
};

export type PublicAPISessionPromptResult = {
  requestBody: PublicAPITurnRequestBody;
  readModel: PublicAPIRunReadModel;
  turn: PublicAPITurnSnapshot | null;
  messages: PublicAPISDKMessage[];
};

export type PublicAPISession = {
  previewRequest: (
    params: PublicAPISessionPromptParams,
  ) => PublicAPITurnRequestBody;
  prompt: (
    params: PublicAPISessionPromptParams,
  ) => Promise<PublicAPISessionPromptResult>;
  reset: () => void;
  getSessionId: () => string;
  getLastTurn: () => PublicAPITurnSnapshot | null;
};

export function createPublicAPISessionID(): string {
  const cryptoAPI = globalThis.crypto;
  if (typeof cryptoAPI?.randomUUID === "function") {
    return cryptoAPI.randomUUID();
  }
  return `sdk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeThinkingRequest(
  thinking: PublicAPISessionPromptParams["thinking"],
): PublicAPITurnRequestBody["thinking"] {
  if (!thinking) {
    return undefined;
  }

  // Some runtimes treat any supplied `effort` as an active reasoning override,
  // even when `enabled` is false. Strip the effort flag on disabled requests so
  // the playground can explicitly disable reasoning without tripping model init.
  return {
    enabled: thinking.enabled,
    effort: thinking.enabled ? thinking.effort : undefined,
  };
}

function buildSessionTurnRequestBody(params: {
  agent: string;
  sessionId: string;
  prompt: PublicAPISessionPromptParams;
}): PublicAPITurnRequestBody {
  return {
    agent: params.agent,
    input: {
      text: params.prompt.text,
      file_ids: params.prompt.fileIds,
    },
    // Claude Code's public SDK accepts prompt/session input while the runtime
    // carries conversation history internally. This helper mirrors that shape
    // on top of `/v1/turns` by keeping one durable session id per chat.
    session_id: params.sessionId,
    stream: params.prompt.stream ?? true,
    metadata: params.prompt.metadata,
    thinking: normalizeThinkingRequest(params.prompt.thinking),
    text: params.prompt.textOptions,
    max_output_tokens: params.prompt.maxOutputTokens,
  };
}

export function createPublicAPISession(params: {
  baseURL: string;
  apiToken: string;
  agent: string;
  traceText: {
    assistantMessage: string;
    assistantThinking: string;
    toolCall: string;
    toolResult: string;
    turnCompleted: string;
    turnStarted: string;
    turnWaiting: string;
    turnFailed: string;
  };
  sessionId?: string;
}): PublicAPISession {
  let sessionId = params.sessionId?.trim() || createPublicAPISessionID();
  let lastTurn: PublicAPITurnSnapshot | null = null;

  return {
    previewRequest(prompt) {
      return buildSessionTurnRequestBody({
        agent: params.agent,
        sessionId,
        prompt,
      });
    },
    async prompt(prompt) {
      const requestBody = this.previewRequest(prompt);
      const projector = createPublicAPISDKMessageProjector({
        agent: params.agent,
        sessionId,
        includePartialMessages: prompt.includePartialMessages,
        onMessage: prompt.onMessage,
      });

      if (requestBody.stream === false) {
        const turn = await createPublicAPITurn({
          baseURL: params.baseURL,
          apiToken: params.apiToken,
          body: requestBody,
          signal: prompt.signal,
        });
        let readModel = createPublicAPIRunReadModel();
        readModel = applyPublicAPITurnSnapshot({
          current: readModel,
          turn,
          traceText: params.traceText,
        });
        projector.finalizeTurn(turn, readModel);
        lastTurn = turn;
        return {
          requestBody,
          readModel,
          turn,
          messages: projector.messages,
        };
      }

      const result = await runStreamedPublicAPITurn({
        baseURL: params.baseURL,
        apiToken: params.apiToken,
        body: requestBody,
        traceText: params.traceText,
        signal: prompt.signal,
        onUpdate: (update) => {
          projector.consume(update);
          prompt.onUpdate?.(update);
        },
      });
      projector.finalizeTurn(result.turn, result.readModel);
      if (result.turn) {
        lastTurn = result.turn;
      }
      return {
        requestBody,
        readModel: result.readModel,
        turn: result.turn,
        messages: projector.messages,
      };
    },
    reset() {
      sessionId = createPublicAPISessionID();
      lastTurn = null;
    },
    getSessionId() {
      return sessionId;
    },
    getLastTurn() {
      return lastTurn;
    },
  };
}
