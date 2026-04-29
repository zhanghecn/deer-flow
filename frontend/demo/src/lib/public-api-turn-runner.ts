import {
  getPublicAPITurn,
  streamPublicAPITurn,
  type PublicAPITurnRequestBody,
  type PublicAPITurnSnapshot,
} from "./public-api";
import {
  normalizePublicAPIStreamEvent,
  type PublicAPINormalizedRunEvent,
} from "./public-api-events";
import {
  applyNormalizedPublicAPIRunEvent,
  applyPublicAPITurnSnapshot,
  createPublicAPIRunReadModel,
  type PublicAPIRunReadModel,
} from "./public-api-run-session";

export type PublicAPITurnStreamUpdate = {
  event: PublicAPINormalizedRunEvent;
  readModel: PublicAPIRunReadModel;
};

export async function runStreamedPublicAPITurn(params: {
  baseURL: string;
  apiToken: string;
  body: PublicAPITurnRequestBody;
  signal?: AbortSignal;
  onUpdate?: (update: PublicAPITurnStreamUpdate) => void;
}): Promise<{
  readModel: PublicAPIRunReadModel;
  turn: PublicAPITurnSnapshot | null;
}> {
  let currentTurnId = "";
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
        });
        currentTurnId = readModel.turnId || currentTurnId;
        params.onUpdate?.({
          event: normalizedEvent,
          readModel,
        });
      }
    },
  });

  // `/v1/turns` must end in a terminal turn state. A clean SSE close without a
  // terminal event is a protocol violation, not an implicit success.
  if (readModel.phase === "streaming") {
    throw new Error("Streaming /v1/turns ended without a terminal turn event.");
  }

  // The stream only guarantees partial progress. Finalizing from the snapshot
  // keeps artifacts, terminal state, and replayed events aligned with `/v1`.
  if (!currentTurnId) {
    return {
      readModel,
      turn: null,
    };
  }

  const turn = await getPublicAPITurn({
    baseURL: params.baseURL,
    apiToken: params.apiToken,
    turnId: currentTurnId,
    signal: params.signal,
  });
  readModel = applyPublicAPITurnSnapshot({
    current: readModel,
    turn,
  });

  return {
    readModel,
    turn,
  };
}
