import { authFetch } from "@/core/auth/fetch";
import { getBackendBaseURL } from "@/core/config";
import type { ExecutionStatus } from "@/core/threads";

export type PublicAPIInvocation = {
  id: string;
  response_id: string;
  surface: string;
  agent_name: string;
  thread_id: string;
  trace_id?: string;
  request_model: string;
  status: string;
  error?: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  created_at: string;
  finished_at?: string;
};

type PublicAPIInvocationsResponse = {
  items?: PublicAPIInvocation[];
};

async function readInvocationError(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
  };
  return payload.error ?? `Failed to load invocation status: ${response.statusText}`;
}

export async function listPublicAPIInvocations(options: {
  threadId?: string;
  limit?: number;
  finishedOnly?: boolean;
}): Promise<PublicAPIInvocation[]> {
  const url = new URL(`${getBackendBaseURL()}/api/public-api/invocations`);
  if (options.threadId) {
    url.searchParams.set("thread_id", options.threadId);
  }
  if (options.limit !== undefined) {
    url.searchParams.set("limit", String(options.limit));
  }
  if (options.finishedOnly !== undefined) {
    url.searchParams.set("finished_only", String(options.finishedOnly));
  }

  const response = await authFetch(url);
  if (!response.ok) {
    throw new Error(await readInvocationError(response));
  }

  const payload = (await response.json()) as PublicAPIInvocationsResponse;
  return Array.isArray(payload.items) ? payload.items : [];
}

export async function getLatestThreadPublicAPIInvocation(
  threadId: string,
): Promise<PublicAPIInvocation | null> {
  const items = await listPublicAPIInvocations({
    threadId,
    limit: 1,
    finishedOnly: true,
  });
  return items[0] ?? null;
}

export function isUnsuccessfulPublicAPIInvocationStatus(status?: string) {
  const normalizedStatus = status?.trim().toLowerCase();
  return (
    normalizedStatus === "failed" ||
    normalizedStatus === "error" ||
    normalizedStatus === "canceled" ||
    normalizedStatus === "cancelled"
  );
}

export function publicAPIInvocationToExecutionStatus(
  invocation: PublicAPIInvocation | null | undefined,
): ExecutionStatus | null {
  if (
    !invocation ||
    !isUnsuccessfulPublicAPIInvocationStatus(invocation.status)
  ) {
    return null;
  }

  const startedAt = invocation.created_at || new Date().toISOString();
  const finishedAt = invocation.finished_at || startedAt;
  const canceled =
    invocation.status.trim().toLowerCase() === "canceled" ||
    invocation.status.trim().toLowerCase() === "cancelled";
  const details = [
    invocation.error?.trim() || "SDK/API run did not complete",
    invocation.response_id ? `Response ID: ${invocation.response_id}` : null,
    invocation.trace_id ? `Trace ID: ${invocation.trace_id}` : null,
  ].filter((value): value is string => Boolean(value));

  // Public API invocations can finish outside the LangGraph stream callback
  // path. Convert that durable ledger row into the same execution-status shape
  // used by the chat timeline so every terminal failure renders in one place.
  return {
    event: canceled ? "interrupted" : "failed",
    phase: "public_api",
    phase_kind: "run",
    started_at: startedAt,
    run_started_at: startedAt,
    finished_at: finishedAt,
    error: details.join(" · "),
    terminal: true,
  };
}

export function mergeExecutionStatusWithPublicAPIStatus(
  liveStatus: ExecutionStatus | null | undefined,
  publicAPIStatus: ExecutionStatus | null | undefined,
): ExecutionStatus | null {
  if (!publicAPIStatus) {
    return liveStatus ?? null;
  }
  if (!liveStatus || liveStatus.event === "completed") {
    return publicAPIStatus;
  }
  return liveStatus;
}
