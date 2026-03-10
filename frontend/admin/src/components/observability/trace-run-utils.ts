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
}

export interface TracePayloadSection {
  key: string;
  title: string;
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

function resolveRunLabel(run: TraceRunSummary): string {
  if (run.runType === "tool") {
    return run.toolName || "Tool";
  }
  if (run.runType === "llm") {
    const modelName = extractModelName(run);
    return modelName ? `LLM · ${modelName}` : "LLM";
  }
  return humanizeNodeName(run.nodeName);
}

function resolveRunSummary(run: TraceRunSummary): string {
  if (run.runType === "tool") return summarizeToolRun(run);
  if (run.runType === "llm") return summarizeLLMRun(run);
  return summarizeChainRun(run);
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
    const requestMessages = modelRequest?.messages;
    if (hasValue(requestMessages)) {
      sections.push({
        key: "request-messages",
        title: "Model Request Messages",
        value: requestMessages,
      });
    }

    if (hasValue(modelRequest?.tools)) {
      sections.push({
        key: "request-tools",
        title: "Registered Tools",
        value: modelRequest?.tools,
      });
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
      sections.push({
        key: "request-config",
        title: "Request Config",
        value: filteredRequestConfig,
      });
    }

    const responseMessages = modelResponse?.messages;
    if (hasValue(responseMessages)) {
      sections.push({
        key: "response-messages",
        title: "Model Response Messages",
        value: responseMessages,
      });
    }

    const responseToolCalls = modelResponse?.tool_calls;
    if (hasValue(responseToolCalls)) {
      sections.push({
        key: "response-tool-calls",
        title: "Model Tool Calls",
        value: responseToolCalls,
      });
    }

    if (hasValue(endPayload?.llm_output)) {
      sections.push({
        key: "llm-output",
        title: "LLM Output Metadata",
        value: endPayload?.llm_output,
      });
    }
  } else if (run.runType === "tool") {
    if (hasValue(startPayload?.tool_call)) {
      sections.push({
        key: "tool-call",
        title: "Tool Call",
        value: startPayload?.tool_call,
      });
    }

    if (hasValue(endPayload?.tool_response)) {
      sections.push({
        key: "tool-response",
        title: "Tool Response",
        value: endPayload?.tool_response,
      });
    }
  } else {
    if (hasValue(startPayload?.inputs)) {
      sections.push({
        key: "chain-inputs",
        title: "Inputs",
        value: startPayload?.inputs,
      });
    }

    if (hasValue(endPayload?.outputs)) {
      sections.push({
        key: "chain-outputs",
        title: "Outputs",
        value: endPayload?.outputs,
      });
    }
  }

  if (hasValue(startPayload?.metadata)) {
    sections.push({
      key: "run-metadata",
      title: "Run Metadata",
      value: startPayload?.metadata,
    });
  }

  return sections;
}

export function isMiddlewareRun(run: TraceRunSummary): boolean {
  return (
    run.runType === "chain" && (run.nodeName?.includes("Middleware") ?? false)
  );
}
