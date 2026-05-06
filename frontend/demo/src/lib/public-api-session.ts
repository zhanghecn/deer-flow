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
  onUpdate?: (update: PublicAPITurnStreamUpdate) => void;
};

export type PublicAPISessionPromptResult = {
  requestBody: PublicAPITurnRequestBody;
  readModel: PublicAPIRunReadModel;
  turn: PublicAPITurnSnapshot | null;
};

export type PublicAPISession = {
  prompt: (
    params: PublicAPISessionPromptParams,
  ) => Promise<PublicAPISessionPromptResult>;
  resumeFromTurn: (turnId: string) => void;
  reset: () => void;
  getSessionId: () => string;
  getPreviousTurnId: () => string;
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
  previousTurnId: string;
  prompt: PublicAPISessionPromptParams;
}): PublicAPITurnRequestBody {
  return {
    agent: params.agent,
    input: {
      text: params.prompt.text,
      file_ids: params.prompt.fileIds,
    },
    // The SDK-owned session id is the durable handle an integrator can bind to
    // its own user record; the backend maps it to an isolated runtime thread.
    session_id: params.sessionId,
    previous_turn_id: params.previousTurnId || undefined,
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
  previousTurnId?: string;
}): PublicAPISession {
  let sessionId = params.sessionId?.trim() || createPublicAPISessionID();
  let previousTurnId = params.previousTurnId?.trim() ?? "";

  return {
    async prompt(prompt) {
      const requestBody = buildSessionTurnRequestBody({
        agent: params.agent,
        sessionId,
        previousTurnId,
        prompt,
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
        previousTurnId = turn.id;
        return {
          requestBody,
          readModel,
          turn,
        };
      }

      const result = await runStreamedPublicAPITurn({
        baseURL: params.baseURL,
        apiToken: params.apiToken,
        body: requestBody,
        signal: prompt.signal,
        onUpdate: prompt.onUpdate,
      });
      if (result.turn) {
        previousTurnId = result.turn.id;
      }
      return {
        requestBody,
        readModel: result.readModel,
        turn: result.turn,
      };
    },
    resumeFromTurn(turnId) {
      // Recovery seeds only the opaque continuation id; full message bodies stay
      // in the public API ledger and are fetched again when needed.
      previousTurnId = turnId.trim();
    },
    reset() {
      sessionId = createPublicAPISessionID();
      previousTurnId = "";
    },
    getSessionId() {
      return sessionId;
    },
    getPreviousTurnId() {
      return previousTurnId;
    },
  };
}
