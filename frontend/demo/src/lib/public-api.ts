export type PublicAPIReasoningEffort =
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "max";

export type PublicAPITurnEventType =
  | "turn.started"
  | "assistant.message.started"
  | "assistant.text.delta"
  | "assistant.reasoning.delta"
  | "tool.call.started"
  | "tool.call.completed"
  | "context.compacted"
  | "turn.requires_input"
  | "assistant.message.completed"
  | "turn.completed"
  | "turn.failed";

export type PublicAPITurnFailureStage =
  | "prepare_run"
  | "stream_execution"
  | "state_fetch"
  | "snapshot_build";

export interface PublicAPITurnArtifact {
  id: string;
  object: string;
  filename: string;
  mime_type?: string | null;
  bytes?: number | null;
  download_url: string;
}

export interface PublicAPITurnUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

export interface PublicAPITurnEvent {
  sequence: number;
  created_at: number;
  turn_id?: string;
  type: PublicAPITurnEventType;
  status?: string;
  message_id?: string;
  tool_call_id?: string;
  tool_name?: string;
  delta?: string;
  text?: string;
  reasoning?: string;
  error?: string;
  stage?: PublicAPITurnFailureStage;
  retryable?: boolean;
  code?: string;
  tool_arguments?: unknown;
  tool_output?: unknown;
  context_before_tokens?: number;
  context_after_tokens?: number;
  context_max_tokens?: number;
  summary_count?: number;
}

export interface PublicAPITurnRequestBody {
  agent: string;
  input: {
    text: string;
    file_ids?: string[];
  };
  session_id?: string;
  previous_turn_id?: string;
  stream?: boolean;
  text?: {
    format?: {
      type: string;
      name?: string;
      schema?: unknown;
      strict?: boolean;
    };
  };
  thinking?: {
    enabled: boolean;
    effort?: PublicAPIReasoningEffort;
  };
  max_output_tokens?: number;
  metadata?: Record<string, unknown>;
}

export interface PublicAPITurnSnapshot {
  id: string;
  object: "turn";
  status: string;
  agent: string;
  session_id?: string;
  thread_id: string;
  trace_id?: string;
  previous_turn_id?: string;
  output_text: string;
  reasoning_text: string;
  artifacts?: PublicAPITurnArtifact[];
  usage: PublicAPITurnUsage;
  metadata?: Record<string, unknown>;
  events: PublicAPITurnEvent[];
  created_at: number;
  completed_at?: number;
}

export interface PublicAPITurnHistoryItem extends PublicAPITurnSnapshot {
  input: {
    text: string;
    file_ids?: string[];
  };
}

export interface PublicAPITurnListResponse {
  object: "list";
  data: PublicAPITurnHistoryItem[];
}

export interface PublicAPITurnStreamEvent {
  event: string;
  data: unknown;
}

export interface PublicAPIFileObject {
  id: string;
  object: string;
  bytes: number;
  created_at: number;
  filename: string;
  purpose: string;
  mime_type?: string | null;
  status?: string;
}

/* ─── Tool call events ──────────────────────────────────── */

export interface ToolCallStartedEvent {
  type: "tool.call.started";
  tool_call_id: string;
  tool_name: string;
  tool_arguments: Record<string, unknown>;
  message_id?: string;
}

export interface ToolCallCompletedEvent {
  type: "tool.call.completed";
  tool_call_id: string;
  tool_name: string;
  tool_output: Array<{
    id?: string;
    text?: string;
    type?: string;
  }>;
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

/**
 * Resolve a public API base URL from an explicit override or environment default.
 * Guarantees the result ends with `/v1` so downstream fetch paths stay relative.
 *
 * Fallback chain:
 * 1. User-supplied explicit base URI
 * 2. VITE_DEMO_PUBLIC_API_BASE_URL from build-time env
 * 3. `window.location.origin + "/v1"` as last resort (will show config warning
 *    in UI when it matches the demo's own origin to avoid 404 on /v1/turns).
 */
export function resolvePublicAPIBaseURL(explicit?: string | null): string {
  const candidate = explicit?.trim();
  if (candidate) {
    const trimmed = trimTrailingSlash(candidate);
    return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
  }
  const envBase = (
    import.meta.env.VITE_DEMO_PUBLIC_API_BASE_URL as string | undefined
  )?.trim();
  if (envBase) {
    const trimmed = trimTrailingSlash(envBase);
    return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
  }
  return `${trimTrailingSlash(window.location.origin)}/v1`;
}

function publicAPIFetch(
  baseURL: string,
  apiToken: string,
  path: string,
  init?: RequestInit,
) {
  const resolvedBaseURL = trimTrailingSlash(baseURL);
  const url = new URL(
    path,
    resolvedBaseURL.endsWith("/v1")
      ? `${resolvedBaseURL}/`
      : `${resolvedBaseURL}/v1/`,
  );
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${apiToken}`);
  return fetch(url, { ...init, headers });
}

async function extractErrorBody(
  response: Response,
): Promise<{ details?: string; error?: string }> {
  return response.json().catch(() => ({})) as Promise<{
    details?: string;
    error?: string;
  }>;
}

// Error responses are not guaranteed to be JSON, so centralize the fallback
// handling to keep each API method consistent.
async function handleAPIError(
  response: Response,
  action: string,
): Promise<never> {
  const error = await extractErrorBody(response);
  throw new Error(
    error.details ?? error.error ?? `Failed to ${action}: ${response.statusText}`,
  );
}

export async function uploadPublicAPIFile(params: {
  baseURL: string;
  apiToken: string;
  file: File;
  purpose?: string;
  signal?: AbortSignal;
}): Promise<PublicAPIFileObject> {
  const formData = new FormData();
  formData.append("purpose", params.purpose ?? "assistants");
  formData.append("file", params.file);

  const response = await publicAPIFetch(
    params.baseURL,
    params.apiToken,
    "./files",
    {
      method: "POST",
      body: formData,
      signal: params.signal,
    },
  );
  if (!response.ok) {
    return handleAPIError(response, "upload file");
  }
  return response.json() as Promise<PublicAPIFileObject>;
}

export async function createPublicAPITurn(params: {
  baseURL: string;
  apiToken: string;
  body: PublicAPITurnRequestBody;
  signal?: AbortSignal;
}): Promise<PublicAPITurnSnapshot> {
  const response = await publicAPIFetch(
    params.baseURL,
    params.apiToken,
    "./turns",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params.body),
      signal: params.signal,
    },
  );
  if (!response.ok) {
    return handleAPIError(response, "create turn");
  }
  return response.json() as Promise<PublicAPITurnSnapshot>;
}

export async function streamPublicAPITurn(params: {
  baseURL: string;
  apiToken: string;
  body: PublicAPITurnRequestBody;
  onEvent: (event: PublicAPITurnStreamEvent) => void;
  signal?: AbortSignal;
}): Promise<void> {
  const response = await publicAPIFetch(
    params.baseURL,
    params.apiToken,
    "./turns",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({ ...params.body, stream: true }),
      signal: params.signal,
    },
  );
  if (!response.ok) {
    return handleAPIError(response, "stream turn");
  }
  if (!response.body) {
    throw new Error("Streaming turn response body is unavailable.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    buffer = flushSSEBuffer(buffer, params.onEvent);
  }

  const tail = `${buffer}${decoder.decode()}`;
  flushSSEBuffer(`${tail}\n\n`, params.onEvent);
}

function flushSSEBuffer(
  input: string,
  onEvent: (event: PublicAPITurnStreamEvent) => void,
): string {
  let buffer = input;
  while (true) {
    const boundary = buffer.indexOf("\n\n");
    if (boundary < 0) return buffer;
    const rawEvent = buffer.slice(0, boundary);
    buffer = buffer.slice(boundary + 2);
    const parsed = parseSSEEvent(rawEvent);
    if (parsed) onEvent(parsed);
  }
}

function parseSSEEvent(rawEvent: string): PublicAPITurnStreamEvent | null {
  const lines = rawEvent
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .filter((line) => line.length > 0 && !line.startsWith(":"));
  if (lines.length === 0) return null;

  let event = "message";
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim() || "message";
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trim());
    }
  }

  const dataText = dataLines.join("\n");
  if (!dataText) return { event, data: {} };
  if (dataText === "[DONE]") return { event, data: "[DONE]" };

  try {
    return { event, data: JSON.parse(dataText) as unknown };
  } catch {
    return { event, data: dataText };
  }
}

export async function getPublicAPITurn(params: {
  baseURL: string;
  apiToken: string;
  turnId: string;
  signal?: AbortSignal;
}): Promise<PublicAPITurnSnapshot> {
  const response = await publicAPIFetch(
    params.baseURL,
    params.apiToken,
    `./turns/${encodeURIComponent(params.turnId)}`,
    { method: "GET", signal: params.signal },
  );
  if (!response.ok) {
    return handleAPIError(response, "fetch turn");
  }
  return response.json() as Promise<PublicAPITurnSnapshot>;
}

export async function listRecentPublicAPITurns(params: {
  baseURL: string;
  apiToken: string;
  agent: string;
  sessionId?: string;
  limit?: number;
  signal?: AbortSignal;
}): Promise<PublicAPITurnListResponse> {
  const searchParams = new URLSearchParams();
  searchParams.set("agent", params.agent);
  if (params.sessionId?.trim()) {
    searchParams.set("session_id", params.sessionId.trim());
  }
  if (params.limit) {
    searchParams.set("limit", String(params.limit));
  }
  const response = await publicAPIFetch(
    params.baseURL,
    params.apiToken,
    `./turns/recent?${searchParams.toString()}`,
    { method: "GET", signal: params.signal },
  );
  if (!response.ok) {
    return handleAPIError(response, "fetch recent turns");
  }
  return response.json() as Promise<PublicAPITurnListResponse>;
}
