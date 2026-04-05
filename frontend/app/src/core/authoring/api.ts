import { authFetch } from "@/core/auth/fetch";
import { getBackendBaseURL } from "@/core/config";

import type {
  AuthoringDraft,
  AuthoringFileEntry,
  AuthoringFilePayload,
} from "./types";

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

export async function createAgentAuthoringDraft(
  name: string,
  request: {
    thread_id: string;
    agent_status?: "dev" | "prod";
  },
): Promise<AuthoringDraft> {
  const response = await authFetch(
    `${getBackendBaseURL()}/api/authoring/agents/${encodeURIComponent(name)}/draft`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    },
  );
  if (!response.ok) {
    const err = (await response.json().catch(() => ({}))) as APIErrorShape;
    throw new Error(
      resolveAPIErrorMessage(
        err,
        `Failed to open agent workbench: ${response.statusText}`,
      ),
    );
  }
  return response.json() as Promise<AuthoringDraft>;
}

export async function createSkillAuthoringDraft(
  name: string,
  request: {
    thread_id: string;
    source_path?: string;
  },
): Promise<AuthoringDraft> {
  const response = await authFetch(
    `${getBackendBaseURL()}/api/authoring/skills/${encodeURIComponent(name)}/draft`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    },
  );
  if (!response.ok) {
    const err = (await response.json().catch(() => ({}))) as APIErrorShape;
    throw new Error(
      resolveAPIErrorMessage(
        err,
        `Failed to open skill workbench: ${response.statusText}`,
      ),
    );
  }
  return response.json() as Promise<AuthoringDraft>;
}

export async function listAuthoringFiles(
  threadId: string,
  path: string,
): Promise<AuthoringFileEntry[]> {
  const params = new URLSearchParams({
    thread_id: threadId,
    path,
  });
  const response = await authFetch(
    `${getBackendBaseURL()}/api/authoring/files?${params.toString()}`,
  );
  if (!response.ok) {
    const err = (await response.json().catch(() => ({}))) as APIErrorShape;
    throw new Error(
      resolveAPIErrorMessage(
        err,
        `Failed to list authoring files: ${response.statusText}`,
      ),
    );
  }
  const payload = (await response.json()) as { files: AuthoringFileEntry[] };
  return payload.files;
}

export async function readAuthoringFile(
  threadId: string,
  path: string,
): Promise<AuthoringFilePayload> {
  const params = new URLSearchParams({
    thread_id: threadId,
    path,
  });
  const response = await authFetch(
    `${getBackendBaseURL()}/api/authoring/file?${params.toString()}`,
  );
  if (!response.ok) {
    const err = (await response.json().catch(() => ({}))) as APIErrorShape;
    throw new Error(
      resolveAPIErrorMessage(
        err,
        `Failed to read authoring file: ${response.statusText}`,
      ),
    );
  }
  return response.json() as Promise<AuthoringFilePayload>;
}

export async function writeAuthoringFile(request: {
  thread_id: string;
  path: string;
  content: string;
}): Promise<void> {
  const response = await authFetch(`${getBackendBaseURL()}/api/authoring/file`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    const err = (await response.json().catch(() => ({}))) as APIErrorShape;
    throw new Error(
      resolveAPIErrorMessage(
        err,
        `Failed to save authoring file: ${response.statusText}`,
      ),
    );
  }
}

export async function saveAgentAuthoringDraft(
  name: string,
  request: {
    thread_id: string;
    agent_status?: "dev" | "prod";
  },
): Promise<void> {
  const response = await authFetch(
    `${getBackendBaseURL()}/api/authoring/agents/${encodeURIComponent(name)}/save`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    },
  );
  if (!response.ok) {
    const err = (await response.json().catch(() => ({}))) as APIErrorShape;
    throw new Error(
      resolveAPIErrorMessage(
        err,
        `Failed to save agent workbench: ${response.statusText}`,
      ),
    );
  }
}

export async function saveSkillAuthoringDraft(
  name: string,
  request: {
    thread_id: string;
  },
): Promise<void> {
  const response = await authFetch(
    `${getBackendBaseURL()}/api/authoring/skills/${encodeURIComponent(name)}/save`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    },
  );
  if (!response.ok) {
    const err = (await response.json().catch(() => ({}))) as APIErrorShape;
    throw new Error(
      resolveAPIErrorMessage(
        err,
        `Failed to save skill workbench: ${response.statusText}`,
      ),
    );
  }
}
