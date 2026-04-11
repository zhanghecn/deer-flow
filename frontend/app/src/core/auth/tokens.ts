import { getBackendBaseURL } from "@/core/config";

import { authFetch } from "./fetch";

export interface APITokenRecord {
  id: string;
  user_id: string;
  // `token` is returned only on owner-authenticated list/create responses so
  // the workspace key manager can re-copy the full credential when permitted.
  token?: string | null;
  name: string;
  scopes: string[];
  status: string;
  allowed_agents: string[];
  metadata?: Record<string, unknown>;
  last_used?: string | null;
  expires_at?: string | null;
  revoked_at?: string | null;
  created_at: string;
}

export interface CreateAPITokenRequest {
  name: string;
  scopes?: string[];
  allowed_agents?: string[];
  metadata?: Record<string, unknown>;
}

export interface APITokenCreateResponse extends APITokenRecord {
  token?: string;
}

type APIErrorShape = {
  detail?: string;
  details?: string;
  error?: string;
};

function resolveAPIErrorMessage(
  payload: APIErrorShape,
  fallback: string,
): string {
  return payload.details ?? payload.detail ?? payload.error ?? fallback;
}

export async function listAPITokens(): Promise<APITokenRecord[]> {
  const response = await authFetch(`${getBackendBaseURL()}/api/auth/tokens`);
  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as APIErrorShape;
    throw new Error(
      resolveAPIErrorMessage(
        error,
        `Failed to load API tokens: ${response.statusText}`,
      ),
    );
  }
  return response.json() as Promise<APITokenRecord[]>;
}

export async function createAPIToken(
  request: CreateAPITokenRequest,
): Promise<APITokenCreateResponse> {
  const response = await authFetch(`${getBackendBaseURL()}/api/auth/tokens`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as APIErrorShape;
    throw new Error(
      resolveAPIErrorMessage(
        error,
        `Failed to create API token: ${response.statusText}`,
      ),
    );
  }
  return response.json() as Promise<APITokenCreateResponse>;
}

export async function deleteAPIToken(id: string): Promise<void> {
  const response = await authFetch(
    `${getBackendBaseURL()}/api/auth/tokens/${encodeURIComponent(id)}`,
    {
      method: "DELETE",
    },
  );
  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as APIErrorShape;
    throw new Error(
      resolveAPIErrorMessage(
        error,
        `Failed to delete API token: ${response.statusText}`,
      ),
    );
  }
}
