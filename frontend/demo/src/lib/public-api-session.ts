import {
  createPublicAPITurn,
  type PublicAPIReasoningEffort,
  type PublicAPITurnRequestBody,
  type PublicAPITurnSnapshot,
} from "./public-api";
import {
  applyPublicAPITurnSnapshot,
  createPublicAPIRunReadModel,
  type PublicAPIRunReadModel,
} from "./public-api-run-session";
import {
  runStreamedPublicAPITurn,
  type PublicAPITurnStreamUpdate,
} from "./public-api-turn-runner";
import {
  createPublicAPISDKMessageProjector,
  type PublicAPISDKMessage,
  type PublicAPISDKMessageUpdate,
} from "./public-api-sdk-messages";

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
  prompt: (
    params: PublicAPISessionPromptParams,
  ) => Promise<PublicAPISessionPromptResult>;
  reset: () => void;
  getSessionId: () => string;
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
  // even when `enabled` is false. Strip effort on disabled requests.
  return {
    enabled: thinking.enabled,
    effort: thinking.enabled ? thinking.effort : undefined,
  };
}

function buildSessionTurnRequestBody(params: {
  agent: string;
  sessionId: string;
  historyScope?: Record<string, string>;
  prompt: PublicAPISessionPromptParams;
}): PublicAPITurnRequestBody {
  const historyScope =
    params.historyScope && Object.keys(params.historyScope).length > 0
      ? params.historyScope
      : undefined;
  return {
    agent: params.agent,
    input: {
      text: params.prompt.text,
      file_ids: params.prompt.fileIds,
    },
    // The SDK-owned session id is the durable handle an integrator can bind to
    // its own user record; the backend maps it to an isolated runtime thread.
    session_id: params.sessionId,
    // history_scope is caller-defined partition metadata. Supplying it keeps
    // continuation and restore calls bound to the same tenant/user slice.
    history_scope: historyScope,
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
  sessionId?: string;
  historyScope?: Record<string, string>;
}): PublicAPISession {
  let sessionId = params.sessionId?.trim() || createPublicAPISessionID();

  return {
    async prompt(prompt) {
      const requestBody = buildSessionTurnRequestBody({
        agent: params.agent,
        sessionId,
        historyScope: params.historyScope,
        prompt,
      });
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
        });
        projector.finalizeTurn(turn, readModel);
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
        signal: prompt.signal,
        onUpdate: (update) => {
          projector.consume(update);
          prompt.onUpdate?.(update);
        },
      });
      projector.finalizeTurn(result.turn, result.readModel);
      return {
        requestBody,
        readModel: result.readModel,
        turn: result.turn,
        messages: projector.messages,
      };
    },
    reset() {
      sessionId = createPublicAPISessionID();
    },
    getSessionId() {
      return sessionId;
    },
  };
}
