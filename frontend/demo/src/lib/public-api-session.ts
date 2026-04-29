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
  reset: () => void;
  getPreviousTurnId: () => string;
};

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
  previousTurnId: string;
  prompt: PublicAPISessionPromptParams;
}): PublicAPITurnRequestBody {
  return {
    agent: params.agent,
    input: {
      text: params.prompt.text,
      file_ids: params.prompt.fileIds,
    },
    // The runtime owns conversation state; the standalone demo only carries the
    // public API continuation id between `/v1/turns` calls.
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
  previousTurnId?: string;
}): PublicAPISession {
  let previousTurnId = params.previousTurnId?.trim() ?? "";

  return {
    async prompt(prompt) {
      const requestBody = buildSessionTurnRequestBody({
        agent: params.agent,
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
    reset() {
      previousTurnId = "";
    },
    getPreviousTurnId() {
      return previousTurnId;
    },
  };
}
