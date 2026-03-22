import { authFetch } from "@/core/auth/fetch";
import { getBackendBaseURL } from "@/core/config";

import {
  resolveThreadSearchParams,
  type ThreadSearchParams,
} from "./search";
import type { AgentThread, ThreadRuntimeBinding } from "./types";

export async function searchThreads(
  params: ThreadSearchParams = {},
): Promise<AgentThread[]> {
  const body = resolveThreadSearchParams(params);

  const res = await authFetch(`${getBackendBaseURL()}/api/threads/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      limit: body.limit,
      offset: body.offset,
      sort_by: body.sortBy,
      sort_order: body.sortOrder,
      select: body.select,
    }),
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
  const res = await authFetch(
    `${getBackendBaseURL()}/api/threads/${threadId}/title`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    },
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(
      err.error ?? `Failed to update thread title: ${res.statusText}`,
    );
  }
  return (await res.json()) as { thread_id: string; title: string };
}

export async function deleteThread(
  threadId: string,
): Promise<{ thread_id: string; deleted: boolean }> {
  const res = await authFetch(
    `${getBackendBaseURL()}/api/threads/${threadId}`,
    {
      method: "DELETE",
    },
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `Failed to delete thread: ${res.statusText}`);
  }
  return (await res.json()) as { thread_id: string; deleted: boolean };
}

export async function clearThreads(): Promise<{ deleted_count: number }> {
  const res = await authFetch(`${getBackendBaseURL()}/api/threads`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(
      err.error ?? `Failed to clear all threads: ${res.statusText}`,
    );
  }
  return (await res.json()) as { deleted_count: number };
}

export async function getThreadRuntime(
  threadId: string,
): Promise<ThreadRuntimeBinding & { thread_id: string }> {
  const res = await authFetch(
    `${getBackendBaseURL()}/api/threads/${threadId}/runtime`,
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(
      err.error ?? `Failed to load thread runtime: ${res.statusText}`,
    );
  }
  return (await res.json()) as ThreadRuntimeBinding & { thread_id: string };
}
