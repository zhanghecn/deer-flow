import OpenAI from "openai";

import { resolvePublicAPIBaseURL, type PublicAPITurnSnapshot } from "./api";
import {
  normalizePublicAPIStreamEvent,
  type PublicAPINormalizedRunEvent,
} from "./events";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

// The docs surface still offers an OpenAI client example for compatibility
// routes, but the first-party runtime contract now centers on `/v1/turns`.
export function createBrowserPublicAPIClient(params: {
  apiToken: string;
  baseURL?: string | null;
}) {
  return new OpenAI({
    apiKey: params.apiToken.trim(),
    baseURL: resolvePublicAPIBaseURL(params.baseURL),
    dangerouslyAllowBrowser: true,
  });
}

export function normalizeSDKResponseEvent(
  rawEvent: unknown,
): PublicAPINormalizedRunEvent[] {
  const record = asRecord(rawEvent);
  const eventName = typeof record?.type === "string" ? record.type : "message";
  const payload = "event" in (record ?? {}) ? record?.event : rawEvent;
  return normalizePublicAPIStreamEvent({ event: eventName, data: payload });
}

export function coercePublicAPITurn(
  rawTurn: unknown,
): PublicAPITurnSnapshot | null {
  const record = asRecord(rawTurn);
  if (!record) {
    return null;
  }

  if (
    typeof record.id !== "string" ||
    typeof record.status !== "string" ||
    record.object !== "turn"
  ) {
    return null;
  }

  return record as unknown as PublicAPITurnSnapshot;
}
