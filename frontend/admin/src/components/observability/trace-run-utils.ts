import type { TraceEvent } from "@/types";
import { normalizeReadableValue } from "./json-inspector-utils";

export interface TraceRunSummary {
  runId: string;
  parentRunId: string | null;
  runType: string;
  status: string;
  nodeName?: string;
  toolName?: string;
  taskRunId?: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  eventCount: number;
  depth: number;
  startEvent?: TraceEvent;
  endEvent?: TraceEvent;
  errorEvent?: TraceEvent;
  label: string;
  summary: string;
  hasReasoning: boolean;
  reasoningPreview?: string;
  hasTruncatedPayload: boolean;
}

export interface TracePayloadSection {
  key: string;
  title: string;
  description: string;
  kind: "reasoning" | "messages" | "tools" | "config" | "state" | "metadata";
  truncated: boolean;
  value: unknown;
}

type RunStatus = "running" | "completed" | "error";

const PREVIEW_KEYS = [
  "title",
  "summary",
  "output",
  "response",
  "message",
  "content",
  "text",
  "preview",
];

const CHAIN_STATE_KEYS = new Set([
  "messages",
  "todos",
  "artifacts",
  "files",
  "skills_metadata",
  "thread_data",
]);

export function extractContextWindowPayload(
  run: TraceRunSummary,
): Record<string, unknown> | null {
  const endPayload = toRecord(run.endEvent?.payload ?? run.errorEvent?.payload);
  const directPayload = toRecord(normalizeTraceValue(endPayload?.context_window));
  if (directPayload) {
    return directPayload;
  }

  const outputsPayload = toRecord(normalizeTraceValue(endPayload?.outputs));
  return toRecord(normalizeTraceValue(outputsPayload?.context_window));
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function hasValue(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as object).length > 0;
  return true;
}

function hasTruncationMarker(value: unknown, depth = 0): boolean {
  if (depth > 8 || value == null) return false;
  if (typeof value === "string") {
    return value.includes("...[truncated");
  }
  if (Array.isArray(value)) {
    return value.some((item) => hasTruncationMarker(item, depth + 1));
  }
  if (typeof value === "object") {
    const payload = toRecord(value);
    if (!payload) return false;
    if (payload.truncated === true) return true;
    if ("__truncated__" in payload) return true;
    return Object.values(payload).some((item) =>
      hasTruncationMarker(item, depth + 1),
    );
  }
  return false;
}

function makeSection(
  key: string,
  title: string,
  description: string,
  kind: TracePayloadSection["kind"],
  value: unknown,
): TracePayloadSection {
  return {
    key,
    title,
    description,
    kind,
    truncated: hasTruncationMarker(value),
    value,
  };
}

function toStatus(status: string | undefined): RunStatus {
  if (status === "error") return "error";
  if (status === "completed") return "completed";
  return "running";
}

function mergeStatus(current: RunStatus, next: RunStatus): RunStatus {
  if (current === "error" || next === "error") {
    return "error";
  }
  if (current === "completed" || next === "completed") {
    return "completed";
  }
  return "running";
}

function truncateText(value: string, max: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1)}...`;
}

function normalizeTraceValue(value: unknown): unknown {
  const normalized = normalizeReadableValue(value);
  const message = toRecord(normalized);
  if (
    message &&
    typeof message.role === "string" &&
    typeof message.content === "string" &&
    Object.keys(message).length <= 2
  ) {
    return message.content;
  }
  return normalized;
}

export function summarizeValue(value: unknown, depth = 0): string {
  if (depth > 3 || value == null) return "";
  const normalized = normalizeTraceValue(value);
  if (normalized !== value) {
    return summarizeValue(normalized, depth);
  }

  if (typeof value === "string") {
    return truncateText(value, 96);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const head = summarizeValue(value[0], depth + 1);
    if (!head) return `array(${value.length})`;
    return value.length > 1 ? `[${head}, ...]` : `[${head}]`;
  }
  if (typeof value === "object") {
    const payload = toRecord(value);
    if (!payload) return "";

    const messageSummary = summarizeMessages(payload.messages);
    if (messageSummary) return messageSummary;

    const toolNames = extractToolNames(payload.tool_calls);
    if (toolNames.length > 0) {
      return `tool calls: ${toolNames.join(", ")}`;
    }

    const priorityText = extractPriorityText(payload, depth + 1);
    if (priorityText) {
      return priorityText;
    }

    const entries = Object.entries(payload).slice(0, 3);
    if (!entries.length) return "{}";
    const compact = entries
      .map(([key, item]) => `${key}:${summarizeValue(item, depth + 1)}`)
      .join(", ");
    return truncateText(compact, 96);
  }
  return "";
}

function summarizeMessages(messages: unknown): string {
  if (!Array.isArray(messages) || messages.length === 0) return "";

  const candidates = [...messages].reverse();
  for (const candidate of candidates) {
    const normalizedCandidate = normalizeTraceValue(candidate);
    const message = toRecord(normalizedCandidate);
    if (!message) {
      const summary = summarizeValue(normalizedCandidate);
      if (summary) return summary;
      continue;
    }

    const role = String(message.role ?? "").toLowerCase();
    if (role === "system") continue;

    const contentSummary = summarizeValue(message.content);
    if (contentSummary) return contentSummary;
  }

  return summarizeValue(messages[messages.length - 1]);
}

function extractToolNames(rawTools: unknown): string[] {
  if (!Array.isArray(rawTools)) return [];
  return rawTools
    .map((tool) => {
      const payload = toRecord(tool);
      if (!payload) return "";
      const functionPayload = toRecord(payload.function);
      if (functionPayload && typeof functionPayload.name === "string") {
        return functionPayload.name;
      }
      if (typeof payload.name === "string") return payload.name;
      return "";
    })
    .filter((name) => name.trim().length > 0);
}

function normalizeMessageCollection(messages: unknown): Record<string, unknown>[] {
  if (!Array.isArray(messages)) return [];

  return messages
    .map((item) => {
      const rawMessage = toRecord(item);
      if (rawMessage) {
        return {
          ...rawMessage,
          content: normalizeReadableValue(rawMessage.content),
          additional_kwargs: normalizeReadableValue(rawMessage.additional_kwargs),
          response_metadata: normalizeReadableValue(rawMessage.response_metadata),
        };
      }

      const normalizedItem = normalizeReadableValue(item);
      return toRecord(normalizedItem);
    })
    .filter((item): item is Record<string, unknown> => item !== null);
}

function selectRecentMessages(messages: unknown, limit = 2): unknown {
  const normalizedMessages = normalizeMessageCollection(messages).filter(
    (message) => {
      const role = String(message.role ?? message.type ?? "").toLowerCase();
      return role !== "system";
    },
  );

  if (normalizedMessages.length === 0) {
    return messages;
  }

  return normalizedMessages.slice(-limit);
}

function extractReasoningText(content: unknown): string {
  if (!Array.isArray(content)) return "";

  return content
    .map((item) => {
      const block = toRecord(item);
      if (!block) return "";
      const blockType = block.type;
      if (blockType !== "thinking" && blockType !== "reasoning") {
        return "";
      }

      for (const key of [
        "thinking",
        "reasoning",
        "reasoning_content",
        "text",
      ] as const) {
        const value = block[key];
        if (typeof value === "string" && value.trim().length > 0) {
          return value.trim();
        }
      }

      return "";
    })
    .filter((value) => value.length > 0)
    .join("\n\n");
}

function extractReasoningSectionValue(messages: unknown): string | null {
  const normalizedMessages = normalizeMessageCollection(messages);
  const chunks: string[] = [];

  for (const message of normalizedMessages) {
    const additionalKwargs = toRecord(message.additional_kwargs);
    const role = typeof message.role === "string" ? message.role : "assistant";
    const reasoningFromKwargs =
      typeof additionalKwargs?.reasoning_content === "string"
        ? additionalKwargs.reasoning_content.trim()
        : "";
    const reasoningFromContent = extractReasoningText(message.content);
    const reasoning = reasoningFromKwargs || reasoningFromContent;
    if (!reasoning) continue;
    chunks.push(`### ${role}\n\n${reasoning}`);
  }

  if (chunks.length === 0) {
    return null;
  }

  return chunks.join("\n\n");
}

function normalizeReasoningPreview(reasoning: string): string {
  return truncateText(
    reasoning
      .replace(/^###\s+[^\n]+\n+/gm, "")
      .replace(/\s+/g, " ")
      .trim(),
    140,
  );
}

function splitChainStateSections(
  prefix: "chain-inputs" | "chain-outputs",
  title: "Input Snapshot" | "Output Snapshot",
  value: unknown,
): TracePayloadSection[] {
  const payload = toRecord(normalizeTraceValue(value));
  if (!payload) {
    return hasValue(value)
      ? [
          makeSection(
            prefix,
            title,
            "Captured LangGraph state for this chain run.",
            "state",
            value,
          ),
        ]
      : [];
  }

  const sections: TracePayloadSection[] = [];
  const recentMessages = selectRecentMessages(payload.messages);
  if (hasValue(recentMessages)) {
    sections.push(
      makeSection(
        `${prefix}-messages`,
        "Recent Messages",
        "Latest non-system messages carried by this chain state. Older conversation history is intentionally hidden here to reduce duplication with LLM runs.",
        "messages",
        recentMessages,
      ),
    );
  }

  if (hasValue(payload.todos)) {
    sections.push(
      makeSection(
        `${prefix}-todos`,
        "Todo State",
        "Task-planning state tracked for this run.",
        "state",
        payload.todos,
      ),
    );
  }

  if (hasValue(payload.artifacts)) {
    sections.push(
      makeSection(
        `${prefix}-artifacts`,
        "Artifacts",
        "Artifacts attached to the conversation state at this step.",
        "state",
        payload.artifacts,
      ),
    );
  }

  if (hasValue(payload.files)) {
    sections.push(
      makeSection(
        `${prefix}-files`,
        "Files",
        "Workspace file state referenced by this run.",
        "state",
        payload.files,
      ),
    );
  }

  if (hasValue(payload.skills_metadata)) {
    sections.push(
      makeSection(
        `${prefix}-skills`,
        "Skill Injection",
        "Skills injected into the prompt/runtime for this step.",
        "state",
        payload.skills_metadata,
      ),
    );
  }

  if (hasValue(payload.thread_data)) {
    sections.push(
      makeSection(
        `${prefix}-thread-data`,
        "Thread Data",
        "Resolved workspace, uploads, and output paths for this thread.",
        "state",
        payload.thread_data,
      ),
    );
  }

  const remaining = Object.fromEntries(
    Object.entries(payload).filter(([key]) => !CHAIN_STATE_KEYS.has(key)),
  );
  if (hasValue(remaining)) {
    sections.push(
      makeSection(
        prefix,
        title,
        "Remaining LangGraph state after separating messages, todos, files, and artifacts into dedicated sections.",
        "state",
        remaining,
      ),
    );
  }

  return sections;
}

function humanizeNodeName(nodeName?: string): string {
  if (!nodeName) return "Chain";
  if (nodeName === "model") return "Model";
  const middlewareMatch = nodeName.match(
    /^([^.]+)\.(before|after)_(agent|model)$/,
  );
  if (middlewareMatch) {
    const [, name, phase, target] = middlewareMatch;
    return `${name} • ${phase} ${target}`;
  }
  return nodeName;
}

function resolveEventNodeName(event: TraceEvent): string | undefined {
  if (event.node_name) return event.node_name;
  const payload = toRecord(event.payload);
  const metadata = toRecord(payload?.metadata);
  const nodeName = metadata?.langgraph_node;
  return typeof nodeName === "string" ? nodeName : undefined;
}

function extractModelName(run: TraceRunSummary): string | undefined {
  const startPayload = toRecord(run.startEvent?.payload);
  const startRequest = toRecord(
    normalizeTraceValue(startPayload?.model_request),
  );
  if (typeof startRequest?.model === "string") {
    return startRequest.model;
  }

  const metadata = toRecord(startPayload?.metadata);
  for (const key of ["ls_model_name", "model_name"]) {
    if (typeof metadata?.[key] === "string") {
      return metadata[key] as string;
    }
  }

  return undefined;
}

const TOOL_PATH_KEYS = [
  "path",
  "file_path",
  "filepath",
  "output_file",
  "output_path",
  "dir_path",
  "directory",
] as const;

const TOOL_COMMAND_KEYS = ["command", "cmd"] as const;
const TOOL_QUERY_KEYS = ["query", "pattern"] as const;

function extractStringAssignment(text: string, keys: readonly string[]): string {
  for (const key of keys) {
    const match = text.match(
      new RegExp(`(?:['"]${key}['"]|\\b${key}\\b)\\s*(?::|=)\\s*(['"])(.*?)\\1`, "s"),
    );
    const value = match?.[2]?.trim();
    if (value) {
      return value;
    }
  }
  return "";
}

function extractVirtualPath(text: string): string {
  const match = text.match(/\/mnt\/user-data\/[^\s'",)]+/);
  return match?.[0] ?? "";
}

function extractToolField(
  value: unknown,
  keys: readonly string[],
  depth = 0,
): string {
  if (depth > 6 || value == null) {
    return "";
  }

  const normalized = normalizeTraceValue(value);
  if (normalized !== value) {
    return extractToolField(normalized, keys, depth + 1);
  }

  if (typeof value === "string") {
    return (
      extractStringAssignment(value, keys) ||
      (keys === TOOL_PATH_KEYS ? extractVirtualPath(value) : "")
    );
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const candidate = extractToolField(item, keys, depth + 1);
      if (candidate) {
        return candidate;
      }
    }
    return "";
  }

  const payload = toRecord(value);
  if (!payload) {
    return "";
  }

  for (const key of keys) {
    const candidate = payload[key];
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }

  for (const nestedKey of [
    "inputs",
    "arguments",
    "tool_call",
    "tool_response",
    "output",
    "response",
    "kwargs",
    "data",
  ] as const) {
    const candidate = extractToolField(payload[nestedKey], keys, depth + 1);
    if (candidate) {
      return candidate;
    }
  }

  for (const nestedValue of Object.values(payload)) {
    const candidate = extractToolField(nestedValue, keys, depth + 1);
    if (candidate) {
      return candidate;
    }
  }

  return "";
}

function extractPriorityText(value: unknown, depth = 0): string {
  if (depth > 5 || value == null) return "";
  const normalized = normalizeTraceValue(value);
  if (normalized !== value) {
    return extractPriorityText(normalized, depth);
  }

  if (typeof value === "string") return truncateText(value, 120);

  if (Array.isArray(value)) {
    for (const item of value) {
      const text = extractPriorityText(item, depth + 1);
      if (text) return text;
    }
    return "";
  }

  const payload = toRecord(value);
  if (!payload) return "";

  const messageSummary = summarizeMessages(payload.messages);
  if (messageSummary) {
    return messageSummary;
  }

  const toolNames = extractToolNames(payload.tool_calls);
  if (toolNames.length > 0) {
    return `tool calls: ${toolNames.join(", ")}`;
  }

  for (const key of PREVIEW_KEYS) {
    if (!(key in payload)) continue;
    const text = extractPriorityText(payload[key], depth + 1);
    if (text) return text;
  }

  return "";
}

function summarizeChainRun(run: TraceRunSummary): string {
  const startPayload = toRecord(run.startEvent?.payload);
  const endPayload = toRecord(run.endEvent?.payload ?? run.errorEvent?.payload);
  const metadata = toRecord(startPayload?.metadata);
  const nodeName =
    typeof metadata?.langgraph_node === "string"
      ? metadata.langgraph_node
      : run.nodeName;

  const outputs = toRecord(normalizeTraceValue(endPayload?.outputs));
  if (outputs?.thread_data && toRecord(outputs.thread_data)) {
    return "prepared workspace, uploads, outputs";
  }
  if (Array.isArray(outputs?.skills_metadata)) {
    return `${outputs.skills_metadata.length} skills injected`;
  }
  if (typeof outputs?.title === "string") {
    return `title: ${truncateText(outputs.title, 90)}`;
  }

  const text =
    extractPriorityText(outputs) ||
    summarizeMessages(outputs?.messages) ||
    extractPriorityText(normalizeTraceValue(startPayload?.inputs));
  if (text) return text;

  if (nodeName?.includes("Middleware")) {
    return "middleware hook";
  }

  return "execution step";
}

function summarizeToolRun(run: TraceRunSummary): string {
  const startPayload = toRecord(run.startEvent?.payload);
  const endPayload = toRecord(run.endEvent?.payload ?? run.errorEvent?.payload);
  const toolCall = normalizeTraceValue(
    startPayload?.tool_call ?? startPayload?.inputs ?? startPayload?.input_str,
  );
  const toolResponse = normalizeTraceValue(
    endPayload?.tool_response ?? endPayload?.output,
  );
  const toolName = run.toolName ?? extractToolField(toolCall, ["name"]);

  const path =
    extractToolField(toolCall, TOOL_PATH_KEYS) ||
    extractToolField(toolResponse, TOOL_PATH_KEYS);
  if (
    path &&
    ["write_file", "edit_file", "str_replace", "read_file", "ls", "glob"].includes(
      toolName,
    )
  ) {
    return truncateText(path, 140);
  }

  const command =
    extractToolField(toolCall, TOOL_COMMAND_KEYS) ||
    extractToolField(toolResponse, TOOL_COMMAND_KEYS);
  if (command && ["execute", "bash"].includes(toolName)) {
    return truncateText(command, 140);
  }

  const query =
    extractToolField(toolCall, TOOL_QUERY_KEYS) ||
    extractToolField(toolResponse, TOOL_QUERY_KEYS);
  if (query && ["web_search", "image_search", "grep"].includes(toolName)) {
    return truncateText(query, 140);
  }

  const requestSummary = summarizeValue(toolCall);
  if (requestSummary) return requestSummary;

  const responseSummary = summarizeValue(toolResponse);
  if (responseSummary) return responseSummary;

  return "tool execution";
}

function summarizeLLMRun(run: TraceRunSummary): string {
  const startPayload = toRecord(run.startEvent?.payload);
  const endPayload = toRecord(run.endEvent?.payload ?? run.errorEvent?.payload);
  const request = toRecord(normalizeTraceValue(startPayload?.model_request));
  const response = toRecord(normalizeTraceValue(endPayload?.model_response));
  const toolNames = extractToolNames(response?.tool_calls);
  if (toolNames.length > 0) {
    return `tool calls: ${toolNames.join(", ")}`;
  }

  const responseSummary = summarizeMessages(response?.messages);
  if (responseSummary) return responseSummary;

  const requestSummary = summarizeMessages(request?.messages);
  if (requestSummary) return requestSummary;

  return "model exchange";
}

function summarizeSystemRun(run: TraceRunSummary): string {
  const contextWindow = extractContextWindowPayload(run);
  if (!contextWindow) {
    return "system event";
  }

  const usageRatio =
    typeof contextWindow.usage_ratio === "number"
      ? contextWindow.usage_ratio
      : null;
  const usageAfter =
    typeof contextWindow.usage_ratio_after_summary === "number"
      ? contextWindow.usage_ratio_after_summary
      : null;
  const approxTokens =
    typeof contextWindow.approx_input_tokens === "number"
      ? contextWindow.approx_input_tokens
      : null;
  const summaryApplied = contextWindow.summary_applied === true;

  if (usageRatio != null && usageAfter != null && summaryApplied) {
    return `${Math.round(usageRatio * 100)}% -> ${Math.round(usageAfter * 100)}% after compaction`;
  }

  if (usageRatio != null) {
    return `${Math.round(usageRatio * 100)}% of prompt window in use`;
  }

  if (approxTokens != null) {
    return `${approxTokens} approx prompt tokens`;
  }

  return "context-window snapshot";
}

function resolveRunLabel(run: TraceRunSummary): string {
  if (run.runType === "tool") {
    return run.toolName || "Tool";
  }
  if (run.runType === "llm") {
    const modelName = extractModelName(run);
    return modelName ? `LLM · ${modelName}` : "LLM";
  }
  if (run.runType === "system") {
    return humanizeNodeName(run.nodeName) || "System";
  }
  return humanizeNodeName(run.nodeName);
}

function resolveRunSummary(run: TraceRunSummary): string {
  if (run.runType === "tool") return summarizeToolRun(run);
  if (run.runType === "llm") return summarizeLLMRun(run);
  if (run.runType === "system") return summarizeSystemRun(run);
  return summarizeChainRun(run);
}

function resolveRunReasoningPreview(run: TraceRunSummary): string {
  if (run.runType !== "llm") {
    return "";
  }

  const endPayload = toRecord(run.endEvent?.payload ?? run.errorEvent?.payload);
  const modelResponse = toRecord(
    normalizeTraceValue(endPayload?.model_response),
  );
  const reasoning = extractReasoningSectionValue(modelResponse?.messages);
  if (!reasoning) {
    return "";
  }

  return normalizeReasoningPreview(reasoning);
}

function resolveRunTruncation(run: TraceRunSummary): boolean {
  return (
    hasTruncationMarker(run.startEvent?.payload) ||
    hasTruncationMarker(run.endEvent?.payload ?? run.errorEvent?.payload)
  );
}

function resolveDepth(
  runId: string,
  runMap: Map<string, TraceRunSummary>,
  rootRunId: string | undefined,
  cache: Map<string, number>,
  visited: Set<string>,
): number {
  if (cache.has(runId)) return cache.get(runId) ?? 0;
  if (visited.has(runId)) return 0;

  const run = runMap.get(runId);
  if (!run) return 0;
  if (rootRunId && runId === rootRunId) {
    cache.set(runId, 0);
    return 0;
  }
  if (!run.parentRunId || !runMap.has(run.parentRunId)) {
    cache.set(runId, 0);
    return 0;
  }

  const nextVisited = new Set(visited);
  nextVisited.add(runId);
  const depth =
    resolveDepth(run.parentRunId, runMap, rootRunId, cache, nextVisited) + 1;
  cache.set(runId, depth);
  return depth;
}

export function buildTraceRuns(
  events: TraceEvent[],
  rootRunId?: string,
): TraceRunSummary[] {
  const runMap = new Map<string, TraceRunSummary>();
  const sortedEvents = [...events].sort(
    (a, b) => a.event_index - b.event_index,
  );

  for (const event of sortedEvents) {
    const existing = runMap.get(event.run_id);
    const run: TraceRunSummary = existing ?? {
      runId: event.run_id,
      parentRunId: event.parent_run_id ?? null,
      runType: event.run_type,
      status: event.status,
      nodeName: resolveEventNodeName(event),
      toolName: event.tool_name,
      taskRunId: event.task_run_id,
      startedAt: event.started_at,
      finishedAt: event.finished_at,
      durationMs: event.duration_ms,
      inputTokens: event.input_tokens,
      outputTokens: event.output_tokens,
      totalTokens: event.total_tokens,
      eventCount: 0,
      depth: 0,
      label: "",
      summary: "",
      hasReasoning: false,
      hasTruncatedPayload: false,
    };

    run.parentRunId = run.parentRunId ?? event.parent_run_id ?? null;
    run.nodeName = run.nodeName ?? resolveEventNodeName(event);
    run.toolName = run.toolName ?? event.tool_name;
    run.taskRunId = run.taskRunId ?? event.task_run_id;
    run.status = mergeStatus(toStatus(run.status), toStatus(event.status));
    run.eventCount += 1;

    if (!run.startedAt && event.started_at) run.startedAt = event.started_at;
    if (event.finished_at) run.finishedAt = event.finished_at;
    if (event.duration_ms != null) run.durationMs = event.duration_ms;
    if (event.input_tokens != null) run.inputTokens = event.input_tokens;
    if (event.output_tokens != null) run.outputTokens = event.output_tokens;
    if (event.total_tokens != null) run.totalTokens = event.total_tokens;

    if (event.event_type === "start" && !run.startEvent) {
      run.startEvent = event;
    }
    if (event.event_type === "end") {
      run.endEvent = event;
    }
    if (event.event_type === "error") {
      run.errorEvent = event;
    }

    runMap.set(event.run_id, run);
  }

  const depthCache = new Map<string, number>();
  for (const run of runMap.values()) {
    run.depth = resolveDepth(
      run.runId,
      runMap,
      rootRunId,
      depthCache,
      new Set(),
    );
    run.label = resolveRunLabel(run);
    run.summary = resolveRunSummary(run);
    run.reasoningPreview = resolveRunReasoningPreview(run) || undefined;
    run.hasReasoning = Boolean(run.reasoningPreview);
    run.hasTruncatedPayload = resolveRunTruncation(run);
  }

  return [...runMap.values()].sort((a, b) => {
    const aTime = a.startedAt
      ? new Date(a.startedAt).getTime()
      : Number.MAX_SAFE_INTEGER;
    const bTime = b.startedAt
      ? new Date(b.startedAt).getTime()
      : Number.MAX_SAFE_INTEGER;
    if (aTime !== bTime) return aTime - bTime;
    return a.runId.localeCompare(b.runId);
  });
}

export function extractRunSections(
  run: TraceRunSummary,
): TracePayloadSection[] {
  const sections: TracePayloadSection[] = [];
  const startPayload = toRecord(run.startEvent?.payload);
  const endPayload = toRecord(run.endEvent?.payload ?? run.errorEvent?.payload);
  const modelRequest = toRecord(
    normalizeTraceValue(startPayload?.model_request),
  );
  const modelResponse = toRecord(
    normalizeTraceValue(endPayload?.model_response),
  );

  if (run.runType === "llm") {
    const reasoning = extractReasoningSectionValue(modelResponse?.messages);
    if (reasoning) {
      sections.push(
        makeSection(
          "response-reasoning",
          "Model Reasoning / Thinking",
          "Internal reasoning blocks emitted by the model and captured by the trace backend.",
          "reasoning",
          reasoning,
        ),
      );
    }

    const requestMessages = modelRequest?.messages;
    if (hasValue(requestMessages)) {
      sections.push(
        makeSection(
          "request-messages",
          "Model Request Messages",
          "Messages sent to the model after middleware and prompt assembly.",
          "messages",
          requestMessages,
        ),
      );
    }

    if (hasValue(modelRequest?.tools)) {
      sections.push(
        makeSection(
          "request-tools",
          "Registered Tools",
          "Tool schemas exposed to the model for this invocation.",
          "tools",
          modelRequest?.tools,
        ),
      );
    }

    const requestConfig = {
      model: modelRequest?.model,
      provider: modelRequest?.provider,
      tool_choice: modelRequest?.tool_choice,
      parallel_tool_calls: modelRequest?.parallel_tool_calls,
      settings: modelRequest?.settings,
      options: modelRequest?.options,
      response_format: modelRequest?.response_format,
      extra_body: modelRequest?.extra_body,
    };
    const filteredRequestConfig = Object.fromEntries(
      Object.entries(requestConfig).filter(([, value]) => hasValue(value)),
    );
    if (hasValue(filteredRequestConfig)) {
      sections.push(
        makeSection(
          "request-config",
          "Request Config",
          "Resolved model, tool-choice, and inference settings for this call.",
          "config",
          filteredRequestConfig,
        ),
      );
    }

    const responseMessages = modelResponse?.messages;
    if (hasValue(responseMessages)) {
      sections.push(
        makeSection(
          "response-messages",
          "Model Response Messages",
          "Assistant messages returned by the model, including tool calls and visible text.",
          "messages",
          responseMessages,
        ),
      );
    }

    const responseToolCalls = modelResponse?.tool_calls;
    if (hasValue(responseToolCalls)) {
      sections.push(
        makeSection(
          "response-tool-calls",
          "Model Tool Calls",
          "Normalized tool call payloads emitted by the model.",
          "tools",
          responseToolCalls,
        ),
      );
    }

    if (hasValue(endPayload?.llm_output)) {
      sections.push(
        makeSection(
          "llm-output",
          "LLM Output Metadata",
          "Provider-specific token usage and stop metadata captured from the SDK response.",
          "metadata",
          endPayload?.llm_output,
        ),
      );
    }
  } else if (run.runType === "tool") {
    if (hasValue(startPayload?.tool_call)) {
      sections.push(
        makeSection(
          "tool-call",
          "Tool Call",
          "Arguments passed into the tool at invocation time.",
          "tools",
          startPayload?.tool_call,
        ),
      );
    }

    if (hasValue(endPayload?.tool_response)) {
      sections.push(
        makeSection(
          "tool-response",
          "Tool Response",
          "Result returned by the tool. If marked as truncated, the backend capture was shortened before the payload was stored.",
          "tools",
          endPayload?.tool_response,
        ),
      );
    }
  } else if (run.runType === "system") {
    const contextWindow = extractContextWindowPayload(run);
    if (hasValue(contextWindow)) {
      sections.push(
        makeSection(
          "context-window",
          "Context Window Snapshot",
          "Approximate prompt occupancy captured by the summarization middleware before the model call.",
          "state",
          contextWindow,
        ),
      );
    }
  } else {
    sections.push(
      ...splitChainStateSections(
        "chain-inputs",
        "Input Snapshot",
        startPayload?.inputs,
      ),
    );
    sections.push(
      ...splitChainStateSections(
        "chain-outputs",
        "Output Snapshot",
        endPayload?.outputs,
      ),
    );
  }

  if (hasValue(startPayload?.metadata)) {
    sections.push(
      makeSection(
        "run-metadata",
        "Run Metadata",
        "LangGraph/OpenAgents metadata captured for this run, including node placement, trace IDs, and runtime config.",
        "metadata",
        startPayload?.metadata,
      ),
    );
  }

  return sections;
}

export function isMiddlewareRun(run: TraceRunSummary): boolean {
  return (
    run.runType === "chain" && (run.nodeName?.includes("Middleware") ?? false)
  );
}

export function isCoreTraceRun(run: TraceRunSummary): boolean {
  if (isMiddlewareRun(run)) {
    return false;
  }

  if (run.runType === "chain" && (run.nodeName === "tools" || run.nodeName === "model")) {
    return false;
  }

  return true;
}
