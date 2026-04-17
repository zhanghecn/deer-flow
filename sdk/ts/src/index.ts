export type OpenAgentsThinkingConfig = {
  enabled: boolean;
  effort?: "minimal" | "low" | "medium" | "high";
};

export type OpenAgentsTurnRequest = {
  agent: string;
  input: {
    text: string;
    file_ids?: string[];
  };
  previous_turn_id?: string;
  // Native turns keeps the same structured-output shape as the compatibility
  // routes so callers do not need a second request vocabulary for JSON schema.
  text?: {
    format?: {
      type: string;
      name?: string;
      schema?: unknown;
      strict?: boolean;
    };
  };
  metadata?: Record<string, unknown>;
  stream?: boolean;
  thinking?: OpenAgentsThinkingConfig;
  max_output_tokens?: number;
};

export type OpenAgentsTurnEventType =
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

export type OpenAgentsTurnEvent = {
  sequence: number;
  created_at: number;
  turn_id: string;
  type: OpenAgentsTurnEventType;
  message_id?: string;
  tool_call_id?: string;
  tool_name?: string;
  delta?: string;
  text?: string;
  reasoning?: string;
  error?: string;
  tool_arguments?: unknown;
  tool_output?: unknown;
};

export type OpenAgentsTurnSnapshot = {
  id: string;
  object: "turn";
  status: string;
  agent: string;
  thread_id: string;
  trace_id?: string;
  previous_turn_id?: string;
  output_text: string;
  reasoning_text: string;
  artifacts?: Array<{
    id: string;
    object: string;
    filename: string;
    mime_type?: string | null;
    bytes?: number | null;
    download_url: string;
  }>;
  usage: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
  metadata?: Record<string, unknown>;
  events: OpenAgentsTurnEvent[];
  created_at: number;
  completed_at?: number;
};

export type OpenAgentsTurnReadModel = {
  turnId: string;
  status: "idle" | "streaming" | "requires_input" | "completed" | "failed";
  outputText: string;
  reasoningText: string;
  toolCallCount: number;
  events: OpenAgentsTurnEvent[];
};

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function resolveBaseURL(baseURL: string) {
  return trimTrailingSlash(baseURL || "").endsWith("/v1")
    ? trimTrailingSlash(baseURL)
    : `${trimTrailingSlash(baseURL)}/v1`;
}

async function parseError(response: Response) {
  try {
    const payload = (await response.json()) as { error?: string; details?: string };
    return payload.details || payload.error || response.statusText;
  } catch {
    return response.statusText;
  }
}

function parseSSE(rawChunk: string) {
  const lines = rawChunk.split("\n");
  let eventName = "message";
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith("event:")) {
      eventName = line.slice("event:".length).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trim());
    }
  }
  if (dataLines.length === 0) {
    return null;
  }
  const joined = dataLines.join("\n");
  if (eventName === "done") {
    return { event: "done", data: {} };
  }
  return { event: eventName, data: JSON.parse(joined) };
}

export function createTurnReadModel(): OpenAgentsTurnReadModel {
  return {
    turnId: "",
    status: "idle",
    outputText: "",
    reasoningText: "",
    toolCallCount: 0,
    events: [],
  };
}

export function applyTurnEvent(
  current: OpenAgentsTurnReadModel,
  event: OpenAgentsTurnEvent,
): OpenAgentsTurnReadModel {
  const next: OpenAgentsTurnReadModel = {
    ...current,
    turnId: event.turn_id || current.turnId,
    events: [...current.events, event],
  };
  switch (event.type) {
    case "turn.started":
      next.status = "streaming";
      return next;
    case "assistant.text.delta":
      next.outputText = `${current.outputText}${event.delta ?? ""}`;
      return next;
    case "assistant.reasoning.delta":
      next.reasoningText = `${current.reasoningText}${event.delta ?? ""}`.trim();
      return next;
    case "tool.call.started":
      next.toolCallCount = current.toolCallCount + 1;
      return next;
    case "turn.requires_input":
      next.status = "requires_input";
      return next;
    case "assistant.message.completed":
      next.outputText = event.text ?? current.outputText;
      next.reasoningText = event.reasoning ?? current.reasoningText;
      return next;
    case "turn.completed":
      next.status = "completed";
      next.outputText = event.text ?? current.outputText;
      next.reasoningText = event.reasoning ?? current.reasoningText;
      return next;
    case "turn.failed":
      next.status = "failed";
      return next;
    default:
      return next;
  }
}

export class OpenAgentsClient {
  private readonly baseURL: string;

  constructor(private readonly config: { baseURL: string; apiKey: string }) {
    this.baseURL = resolveBaseURL(config.baseURL);
  }

  private async request(path: string, init?: RequestInit) {
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${this.config.apiKey}`);
    if (!headers.has("Content-Type") && init?.body) {
      headers.set("Content-Type", "application/json");
    }
    return fetch(`${this.baseURL}${path}`, { ...init, headers });
  }

  async createTurn(request: OpenAgentsTurnRequest): Promise<OpenAgentsTurnSnapshot> {
    const response = await this.request("/turns", {
      method: "POST",
      body: JSON.stringify({ ...request, stream: false }),
    });
    if (!response.ok) {
      throw new Error(await parseError(response));
    }
    return (await response.json()) as OpenAgentsTurnSnapshot;
  }

  async getTurn(turnID: string): Promise<OpenAgentsTurnSnapshot> {
    const response = await this.request(`/turns/${encodeURIComponent(turnID)}`);
    if (!response.ok) {
      throw new Error(await parseError(response));
    }
    return (await response.json()) as OpenAgentsTurnSnapshot;
  }

  async *streamTurn(request: OpenAgentsTurnRequest): AsyncGenerator<OpenAgentsTurnEvent> {
    const response = await this.request("/turns", {
      method: "POST",
      body: JSON.stringify({ ...request, stream: true }),
    });
    if (!response.ok) {
      throw new Error(await parseError(response));
    }
    if (!response.body) {
      throw new Error("turn stream response did not include a body");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() ?? "";
      for (const chunk of chunks) {
        const parsed = parseSSE(chunk);
        if (!parsed || parsed.event === "done") {
          continue;
        }
        yield parsed.data as OpenAgentsTurnEvent;
      }
      if (done) {
        break;
      }
    }
  }
}
