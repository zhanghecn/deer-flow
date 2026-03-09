import { authFetch } from "@/core/auth/fetch";
import { getBackendBaseURL } from "@/core/config";

import type { AgentThread } from "./types";

export type ThreadSearchParams = {
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortOrder?: string;
  select?: string[];
};

export async function searchThreads(
  params: ThreadSearchParams = {
    limit: 50,
    offset: 0,
    sortBy: "updated_at",
    sortOrder: "desc",
    select: ["thread_id", "updated_at", "values"],
  },
): Promise<AgentThread[]> {
  const body = {
    limit: params.limit ?? 50,
    offset: params.offset ?? 0,
    sort_by: params.sortBy ?? "updated_at",
    sort_order: params.sortOrder ?? "desc",
    select: params.select ?? ["thread_id", "updated_at", "values"],
  };

  const res = await authFetch(`${getBackendBaseURL()}/api/threads/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `Failed to load threads: ${res.statusText}`);
  }
  return (await res.json()) as AgentThread[];
}

export async function updateThreadTitle(
  threadId: string,
  title: string,
): Promise<{ thread_id: string; title: string }> {
  const res = await authFetch(`${getBackendBaseURL()}/api/threads/${threadId}/title`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `Failed to update thread title: ${res.statusText}`);
  }
  return (await res.json()) as { thread_id: string; title: string };
}
