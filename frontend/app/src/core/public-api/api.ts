import { getBackendBaseURL } from "@/core/config";

type PublicAPIErrorShape = {
  details?: string;
  error?: string;
};

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

export type PublicAPITurnEventType =
  | "turn.started"
  | "assistant.message.started"
  | "assistant.text.delta"
  | "assistant.reasoning.delta"
  | "tool.call.started"
  | "tool.call.completed"
  | "turn.requires_input"
  | "assistant.message.completed"
  | "turn.completed"
  | "turn.failed";

export interface PublicAPITurnEvent {
  sequence: number;
  created_at: number;
  turn_id: string;
  type: PublicAPITurnEventType;
  message_id?: string;
  tool_call_id?: string;
  tool_name?: string;
  delta?: string;
  text?: string;
  reasoning?: string;
  error?: string;
  tool_arguments?: unknown;
  tool_output?: unknown;
}

export interface PublicAPITurnRequestBody {
  agent: string;
  input: {
    text: string;
    file_ids?: string[];
  };
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
    effort?: string;
  };
  max_output_tokens?: number;
  metadata?: Record<string, unknown>;
}

export interface PublicAPITurnSnapshot {
  id: string;
  object: "turn";
  status: string;
  agent: string;
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

export interface PublicAPITurnStreamEvent {
  event: string;
  data: unknown;
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function extractErrorMessage(
  payload: PublicAPIErrorShape,
  fallback: string,
): string {
  return payload.details ?? payload.error ?? fallback;
}

function extractFilenameFromDisposition(
  headerValue: string | null,
): string | null {
  if (!headerValue) {
    return null;
  }

  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(headerValue);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1]);
  }

  const plainMatch = /filename=\"?([^\";]+)\"?/i.exec(headerValue);
  return plainMatch?.[1] ?? null;
}

function triggerBrowserDownload(blob: Blob, filename: string) {
  const objectURL = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectURL;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectURL), 1_000);
}

function publicAPIFetch(
  baseURL: string,
  apiToken: string,
  path: string,
  init?: RequestInit,
) {
  const resolvedBaseURL =
    trimTrailingSlash(baseURL) || `${getBackendBaseURL()}/v1`;
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

export function resolvePublicAPIBaseURL(explicitBaseURL?: string | null) {
  const candidate = explicitBaseURL?.trim();
  if (candidate) {
    const trimmed = trimTrailingSlash(candidate);
    return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
  }
  return `${trimTrailingSlash(getBackendBaseURL())}/v1`;
}

export async function uploadPublicAPIFile(params: {
  baseURL: string;
  apiToken: string;
  file: File;
  purpose?: string;
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
    },
  );
  if (!response.ok) {
    const error = (await response
      .json()
      .catch(() => ({}))) as PublicAPIErrorShape;
    throw new Error(
      extractErrorMessage(
        error,
        `Failed to upload file: ${response.statusText}`,
      ),
    );
  }
  return response.json() as Promise<PublicAPIFileObject>;
}

export async function createPublicAPITurn(params: {
  baseURL: string;
  apiToken: string;
  body: PublicAPITurnRequestBody;
}): Promise<PublicAPITurnSnapshot> {
  const response = await publicAPIFetch(params.baseURL, params.apiToken, "./turns", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params.body),
  });
  if (!response.ok) {
    const error = (await response
      .json()
      .catch(() => ({}))) as PublicAPIErrorShape;
    throw new Error(
      extractErrorMessage(error, `Failed to create turn: ${response.statusText}`),
    );
  }
  return response.json() as Promise<PublicAPITurnSnapshot>;
}

export async function getPublicAPITurn(params: {
  baseURL: string;
  apiToken: string;
  turnId: string;
}): Promise<PublicAPITurnSnapshot> {
  const response = await publicAPIFetch(
    params.baseURL,
    params.apiToken,
    `./turns/${encodeURIComponent(params.turnId)}`,
    {
      method: "GET",
    },
  );
  if (!response.ok) {
    const error = (await response
      .json()
      .catch(() => ({}))) as PublicAPIErrorShape;
    throw new Error(
      extractErrorMessage(error, `Failed to fetch turn: ${response.statusText}`),
    );
  }
  return response.json() as Promise<PublicAPITurnSnapshot>;
}

export async function streamPublicAPITurn(params: {
  baseURL: string;
  apiToken: string;
  body: PublicAPITurnRequestBody;
  onEvent: (event: PublicAPITurnStreamEvent) => void;
}): Promise<void> {
  const response = await publicAPIFetch(params.baseURL, params.apiToken, "./turns", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({ ...params.body, stream: true }),
  });
  if (!response.ok) {
    const error = (await response
      .json()
      .catch(() => ({}))) as PublicAPIErrorShape;
    throw new Error(
      extractErrorMessage(error, `Failed to stream turn: ${response.statusText}`),
    );
  }
  if (!response.body) {
    throw new Error("Streaming turn response body is unavailable.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    buffer = flushSSEBuffer(buffer, params.onEvent);
  }

  const tail = `${buffer}${decoder.decode()}`;
  flushSSEBuffer(`${tail}\n\n`, params.onEvent);
}

export async function downloadPublicAPIArtifact(params: {
  baseURL: string;
  apiToken: string;
  artifact: PublicAPITurnArtifact;
}): Promise<string> {
  const response = await publicAPIFetch(
    params.baseURL,
    params.apiToken,
    params.artifact.download_url,
    {
      method: "GET",
    },
  );
  if (!response.ok) {
    const error = (await response
      .json()
      .catch(() => ({}))) as PublicAPIErrorShape;
    throw new Error(
      extractErrorMessage(
        error,
        `Failed to download file: ${response.statusText}`,
      ),
    );
  }

  const blob = await response.blob();
  const filename =
    extractFilenameFromDisposition(
      response.headers.get("Content-Disposition"),
    ) ?? params.artifact.filename;
  triggerBrowserDownload(blob, filename);
  return filename;
}

function flushSSEBuffer(
  input: string,
  onEvent: (event: PublicAPITurnStreamEvent) => void,
) {
  let buffer = input;
  while (true) {
    const boundary = buffer.indexOf("\n\n");
    if (boundary < 0) {
      return buffer;
    }

    const rawEvent = buffer.slice(0, boundary);
    buffer = buffer.slice(boundary + 2);

    const parsed = parseSSEEvent(rawEvent);
    if (parsed) {
      onEvent(parsed);
    }
  }
}

function parseSSEEvent(rawEvent: string): PublicAPITurnStreamEvent | null {
  const lines = rawEvent
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .filter((line) => line.length > 0 && !line.startsWith(":"));
  if (lines.length === 0) {
    return null;
  }

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
  if (!dataText) {
    return { event, data: {} };
  }
  if (dataText === "[DONE]") {
    return { event, data: "[DONE]" };
  }

  try {
    return {
      event,
      data: JSON.parse(dataText) as unknown,
    };
  } catch {
    return {
      event,
      data: dataText,
    };
  }
}
