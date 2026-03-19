"use client";

import { Client as LangGraphClient } from "@langchain/langgraph-sdk/client";

import { getAuthToken, getAuthUser } from "@/core/auth/store";

import { getLangGraphBaseURL } from "../config";

const CLIENT_CACHE_LIMIT = 32;
const clientCache = new Map<string, LangGraphClient>();

function normalizeClientCacheValue(value: string | null | undefined) {
  return value?.trim() || "-";
}

function buildClientCacheKey(
  isMock: boolean,
  token: string | null,
  userId: string | null,
  threadId: string | null,
) {
  return [
    isMock ? "mock" : "live",
    normalizeClientCacheValue(token),
    normalizeClientCacheValue(userId),
    normalizeClientCacheValue(threadId),
  ].join("::");
}

function buildDefaultHeaders(
  token: string | null,
  userId: string | null,
  threadId: string | null,
) {
  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (userId) {
    headers["x-user-id"] = userId;
  }
  if (threadId) {
    headers["x-thread-id"] = threadId;
  }
  return headers;
}

function cacheClient(key: string, client: LangGraphClient) {
  if (clientCache.size >= CLIENT_CACHE_LIMIT) {
    clientCache.clear();
  }
  clientCache.set(key, client);
}

export function getAPIClient(
  isMock?: boolean,
  threadId?: string | null,
): LangGraphClient {
  const token = getAuthToken();
  const userId = getAuthUser()?.id ?? null;
  const normalizedThreadId = threadId?.trim() || null;
  const cacheKey = buildClientCacheKey(
    isMock === true,
    token,
    userId,
    normalizedThreadId,
  );

  const cachedClient = clientCache.get(cacheKey);
  if (cachedClient) {
    return cachedClient;
  }

  const client = new LangGraphClient({
    apiUrl: getLangGraphBaseURL(isMock),
    defaultHeaders: buildDefaultHeaders(token, userId, normalizedThreadId),
  });
  cacheClient(cacheKey, client);

  return client;
}
