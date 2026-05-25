import { authFetch } from "@/core/auth/fetch";
import { getBackendBaseURL } from "@/core/config";

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
