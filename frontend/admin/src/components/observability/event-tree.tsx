import { Bot, ChevronRight, Hammer, Link2, Workflow } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatAgo } from "@/lib/format";
import type { TraceEvent } from "@/types";
import { JsonMarkdownInspector } from "./json-markdown-inspector";

interface EventTreeProps {
  events: TraceEvent[];
}

function runTypeIcon(runType: string) {
  switch (runType) {
    case "llm":
      return <Bot className="h-3.5 w-3.5 text-purple-500" />;
    case "tool":
      return <Hammer className="h-3.5 w-3.5 text-amber-500" />;
    case "chain":
      return <Link2 className="h-3.5 w-3.5 text-blue-500" />;
    default:
      return <Workflow className="h-3.5 w-3.5 text-muted-foreground" />;
  }
}

function computeDepths(events: TraceEvent[]): Map<string, number> {
  const depthMap = new Map<string, number>();
  const runIdDepth = new Map<string, number>();

  for (const evt of events) {
    if (!runIdDepth.has(evt.run_id)) {
      const parentDepth = evt.parent_run_id
        ? (runIdDepth.get(evt.parent_run_id) ?? 0)
        : 0;
      const depth = evt.parent_run_id ? parentDepth + 1 : 0;
      runIdDepth.set(evt.run_id, depth);
    }
    depthMap.set(`${evt.id}`, runIdDepth.get(evt.run_id) ?? 0);
  }

  return depthMap;
}

type EventSection = {
  key: string;
  title: string;
  value: unknown;
};

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

function extractSections(evt: TraceEvent): EventSection[] {
  const payload = toRecord(evt.payload);
  if (!payload) return [];

  const sections: EventSection[] = [];
  const modelRequest = toRecord(payload.model_request);
  const modelResponse = toRecord(payload.model_response);

  const requestMessages =
    modelRequest?.messages ??
    (evt.run_type === "llm" && evt.event_type === "start"
      ? payload.messages
      : undefined);
  if (hasValue(requestMessages)) {
    sections.push({
      key: "model-request",
      title: "Model Request Messages",
      value: requestMessages,
    });
  }

  const responseMessages =
    modelResponse?.messages ??
    (evt.run_type === "llm" && evt.event_type !== "start"
      ? payload.messages
      : undefined);
  if (hasValue(responseMessages)) {
    sections.push({
      key: "model-response",
      title: "Model Response Messages",
      value: responseMessages,
    });
  }

  const toolCalls = modelResponse?.tool_calls ?? payload.tool_calls;
  if (hasValue(toolCalls)) {
    sections.push({
      key: "model-tool-calls",
      title: "Model Tool Calls",
      value: toolCalls,
    });
  }

  let toolCall = payload.tool_call;
  if (!hasValue(toolCall)) {
    const legacyToolCall: Record<string, unknown> = {};
    if (hasValue(payload.input_str)) legacyToolCall.input_str = payload.input_str;
    if (hasValue(payload.inputs)) legacyToolCall.inputs = payload.inputs;
    if (Object.keys(legacyToolCall).length > 0) {
      toolCall = legacyToolCall;
    }
  }
  if (hasValue(toolCall)) {
    sections.push({
      key: "tool-call",
      title: "Tool Call",
      value: toolCall,
    });
  }

  let toolResponse = payload.tool_response;
  if (!hasValue(toolResponse) && hasValue(payload.output)) {
    toolResponse = { output: payload.output };
  }
  if (hasValue(toolResponse)) {
    sections.push({
      key: "tool-response",
      title: "Tool Response",
      value: toolResponse,
    });
  }

  if (!sections.length && hasValue(payload)) {
    sections.push({
      key: "payload",
      title: "Payload",
      value: payload,
    });
  }

  return sections;
}

export function EventTree({ events }: EventTreeProps) {
  if (!events.length) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">
        No events
      </p>
    );
  }

  const depths = computeDepths(events);

  return (
    <div className="space-y-0.5">
      {events.map((evt) => {
        const depth = depths.get(`${evt.id}`) ?? 0;
        const isError = evt.status === "error";
        const sections = extractSections(evt);

        return (
          <div
            key={evt.id}
            className={cn(
              "flex items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/50 transition-colors",
              isError && "bg-red-50 dark:bg-red-950/30",
            )}
            style={{ paddingLeft: `${depth * 20 + 8}px` }}
          >
            {depth > 0 && (
              <ChevronRight className="h-3 w-3 mt-1 text-muted-foreground/50 shrink-0" />
            )}
            <div className="mt-0.5 shrink-0">{runTypeIcon(evt.run_type)}</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <Badge variant="outline" className="text-xs px-1.5 py-0">
                  {evt.run_type}
                </Badge>
                <Badge variant="secondary" className="text-xs px-1.5 py-0">
                  {evt.event_type}
                </Badge>
                {evt.node_name && (
                  <span className="text-xs font-medium">{evt.node_name}</span>
                )}
                {evt.tool_name && (
                  <Badge
                    variant="outline"
                    className="text-xs px-1.5 py-0 border-amber-300 text-amber-700 dark:text-amber-300"
                  >
                    {evt.tool_name}
                  </Badge>
                )}
                {evt.task_run_id && (
                  <Badge
                    variant="outline"
                    className="text-xs px-1.5 py-0 border-purple-300 text-purple-700 dark:text-purple-300"
                  >
                    sub-agent
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                {(evt.total_tokens != null && evt.total_tokens > 0) && (
                  <span className="tabular-nums">
                    {evt.input_tokens ?? 0}↓ {evt.output_tokens ?? 0}↑
                  </span>
                )}
                {evt.duration_ms != null && (
                  <span className="tabular-nums">{evt.duration_ms}ms</span>
                )}
                {evt.started_at && <span>{formatAgo(evt.started_at)}</span>}
              </div>
              {evt.error && (
                <p className="text-xs text-red-600 dark:text-red-400 mt-1 break-all">
                  {evt.error}
                </p>
              )}
              {sections.length > 0 && (
                <details className="mt-2 rounded-md border border-border/60 bg-muted/20">
                  <summary className="cursor-pointer select-none px-2 py-1 text-xs text-muted-foreground">
                    details
                  </summary>
                  <div className="space-y-2 p-2">
                    {sections.map((section) => (
                      <div key={section.key} className="space-y-1">
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                          {section.title}
                        </p>
                        <JsonMarkdownInspector value={section.value} />
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
