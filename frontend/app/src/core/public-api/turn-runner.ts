import {
  getPublicAPITurn,
  streamPublicAPITurn,
  type PublicAPITurnRequestBody,
  type PublicAPITurnSnapshot,
} from "./api";
import {
  normalizePublicAPIStreamEvent,
  type PlaygroundTraceText,
  type PublicAPINormalizedRunEvent,
} from "./events";
import {
  applyNormalizedPublicAPIRunEvent,
  applyPublicAPITurnSnapshot,
  createPublicAPIRunReadModel,
  type PublicAPIRunReadModel,
} from "./run-session";

export type PublicAPITurnStreamUpdate = {
  event: PublicAPINormalizedRunEvent;
  readModel: PublicAPIRunReadModel;
};

export async function runStreamedPublicAPITurn(params: {
  baseURL: string;
  apiToken: string;
  body: PublicAPITurnRequestBody;
  traceText: PlaygroundTraceText;
  signal?: AbortSignal;
  onUpdate?: (update: PublicAPITurnStreamUpdate) => void;
}): Promise<{
  readModel: PublicAPIRunReadModel;
  turn: PublicAPITurnSnapshot | null;
}> {
  let currentTurnID = "";
  let readModel = createPublicAPIRunReadModel();

  await streamPublicAPITurn({
    baseURL: params.baseURL,
    apiToken: params.apiToken,
    signal: params.signal,
    body: params.body,
    onEvent: (event) => {
      for (const normalizedEvent of normalizePublicAPIStreamEvent(event)) {
        readModel = applyNormalizedPublicAPIRunEvent({
          current: readModel,
          event: normalizedEvent,
          traceText: params.traceText,
        });
        currentTurnID = readModel.turnId || currentTurnID;
        params.onUpdate?.({
          event: normalizedEvent,
          readModel,
        });
      }
    },
  });

  // `/v1/turns` must always end in a terminal turn state. A clean SSE close
  // without `turn.completed`, `turn.failed`, or `turn.requires_input` is a
  // protocol violation, not an implicit success.
  if (readModel.phase === "streaming") {
    throw new Error("Streaming /v1/turns ended without a terminal turn event.");
  }

  // The stream only guarantees partial progress. Finalizing from the snapshot
  // keeps artifacts, terminal state, and replayed events aligned with the
  // canonical `/v1/turns/{id}` contract.
  if (!currentTurnID) {
    return {
      readModel,
      turn: null,
    };
  }

  const turn = await getPublicAPITurn({
    baseURL: params.baseURL,
    apiToken: params.apiToken,
    turnId: currentTurnID,
    signal: params.signal,
  });
  readModel = applyPublicAPITurnSnapshot({
    current: readModel,
    turn,
    traceText: params.traceText,
  });

  return {
    readModel,
    turn,
  };
}
