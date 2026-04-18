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
  previewRequest: (params: PublicAPISessionPromptParams) => PublicAPITurnRequestBody;
  prompt: (
    params: PublicAPISessionPromptParams,
  ) => Promise<PublicAPISessionPromptResult>;
  reset: () => void;
  seed: (turn: Pick<PublicAPITurnSnapshot, "id"> | string) => void;
  getPreviousTurnId: () => string;
  getLastTurn: () => PublicAPITurnSnapshot | null;
};

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
    // Claude Code's public SDK accepts prompt/session input while the runtime
    // carries conversation history internally. This helper mirrors that shape
    // on top of `/v1/turns` by owning the continuation turn id locally.
    previous_turn_id: params.previousTurnId || undefined,
    stream: params.prompt.stream ?? true,
    metadata: params.prompt.metadata,
    thinking: params.prompt.thinking,
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
  previousTurnId?: string;
}): PublicAPISession {
  let previousTurnId = params.previousTurnId?.trim() ?? "";
  let lastTurn: PublicAPITurnSnapshot | null = null;

  return {
    previewRequest(prompt) {
      return buildSessionTurnRequestBody({
        agent: params.agent,
        previousTurnId,
        prompt,
      });
    },
    async prompt(prompt) {
      const requestBody = this.previewRequest(prompt);

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
        previousTurnId = turn.id;
        lastTurn = turn;
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
        traceText: params.traceText,
        signal: prompt.signal,
        onUpdate: prompt.onUpdate,
      });
      if (result.turn) {
        previousTurnId = result.turn.id;
        lastTurn = result.turn;
      }
      return {
        requestBody,
        readModel: result.readModel,
        turn: result.turn,
      };
    },
    reset() {
      previousTurnId = "";
      lastTurn = null;
    },
    seed(turn) {
      previousTurnId = typeof turn === "string" ? turn.trim() : turn.id.trim();
    },
    getPreviousTurnId() {
      return previousTurnId;
    },
    getLastTurn() {
      return lastTurn;
    },
  };
}
