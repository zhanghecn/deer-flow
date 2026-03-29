import { Client as LangGraphClient } from "@langchain/langgraph-sdk/client";

import { getAuthToken, getAuthUser } from "@/core/auth/store";

import { getLangGraphBaseURL } from "../config";

const CLIENT_CACHE_LIMIT = 32;
const clientCache = new Map<string, LangGraphClient>();

type APIClientRuntimeIdentity = {
  agent_name?: string | undefined;
  agent_status?: "dev" | "prod" | undefined;
  execution_backend?: "remote" | undefined;
  remote_session_id?: string | undefined;
  model_name?: string | undefined;
};

function normalizeClientCacheValue(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : "-";
}

function buildClientCacheKey(
  isMock: boolean,
  token: string | null,
  userId: string | null,
  threadId: string | null,
  runtimeIdentity?: APIClientRuntimeIdentity | null,
) {
  return [
    isMock ? "mock" : "live",
    normalizeClientCacheValue(token),
    normalizeClientCacheValue(userId),
    normalizeClientCacheValue(threadId),
    normalizeClientCacheValue(runtimeIdentity?.model_name),
    normalizeClientCacheValue(runtimeIdentity?.agent_name),
    normalizeClientCacheValue(runtimeIdentity?.agent_status),
    normalizeClientCacheValue(runtimeIdentity?.execution_backend),
    normalizeClientCacheValue(
      runtimeIdentity?.execution_backend === "remote"
        ? runtimeIdentity.remote_session_id
        : null,
    ),
  ].join("::");
}

function normalizeHeaderValue(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : null;
}

function buildDefaultHeaders(
  token: string | null,
  userId: string | null,
  threadId: string | null,
  runtimeIdentity?: APIClientRuntimeIdentity | null,
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
  const modelName = normalizeHeaderValue(runtimeIdentity?.model_name);
  if (modelName) {
    headers["x-model-name"] = modelName;
  }
  const agentName = normalizeHeaderValue(runtimeIdentity?.agent_name);
  if (agentName) {
    headers["x-agent-name"] = agentName;
  }
  const agentStatus = normalizeHeaderValue(runtimeIdentity?.agent_status);
  if (agentStatus) {
    headers["x-agent-status"] = agentStatus;
  }
  const executionBackend =
    runtimeIdentity?.execution_backend === "remote" ? "remote" : null;
  if (executionBackend) {
    headers["x-execution-backend"] = executionBackend;
  }
  const remoteSessionId =
    executionBackend === "remote"
      ? normalizeHeaderValue(runtimeIdentity?.remote_session_id)
      : null;
  if (remoteSessionId) {
    headers["x-remote-session-id"] = remoteSessionId;
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
  runtimeIdentity?: APIClientRuntimeIdentity | null,
): LangGraphClient {
  const token = getAuthToken();
  const userId = getAuthUser()?.id ?? null;
  const trimmedThreadId = threadId?.trim();
  const normalizedThreadId =
    trimmedThreadId && trimmedThreadId.length > 0 ? trimmedThreadId : null;
  const cacheKey = buildClientCacheKey(
    isMock === true,
    token,
    userId,
    normalizedThreadId,
    runtimeIdentity,
  );

  const cachedClient = clientCache.get(cacheKey);
  if (cachedClient) {
    return cachedClient;
  }

  const client = new LangGraphClient({
    apiUrl: getLangGraphBaseURL(isMock),
    defaultHeaders: buildDefaultHeaders(
      token,
      userId,
      normalizedThreadId,
      runtimeIdentity,
    ),
  });
  cacheClient(cacheKey, client);

  return client;
}
