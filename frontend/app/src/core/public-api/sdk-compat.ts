import OpenAI from "openai";

import { resolvePublicAPIBaseURL, type PublicAPIResponseEnvelope } from "./api";
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

// The public docs support demo deliberately uses the official browser SDK
// against Deer Flow's published `/v1` contract so customer-side compatibility
// gets validated without routing through workspace-only helpers.
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

// Deer Flow streams a small OpenAI-compatible event envelope plus
// `response.run_event` extensions. Reuse the existing normalization path so the
// SDK demo and internal playground stay aligned on one event vocabulary.
export function normalizeSDKResponseEvent(
  rawEvent: unknown,
): PublicAPINormalizedRunEvent[] {
  const record = asRecord(rawEvent);
  const eventName = typeof record?.type === "string" ? record.type : "message";
  return normalizePublicAPIStreamEvent({ event: eventName, data: rawEvent });
}

// The official SDK types do not know Deer Flow's `openagents` extension, so
// the support demo narrows the retrieved payload locally before reading it.
export function coercePublicAPIResponse(
  rawResponse: unknown,
): PublicAPIResponseEnvelope | null {
  const record = asRecord(rawResponse);
  if (!record) {
    return null;
  }

  if (typeof record.id !== "string" || typeof record.status !== "string") {
    return null;
  }

  return record as unknown as PublicAPIResponseEnvelope;
}
