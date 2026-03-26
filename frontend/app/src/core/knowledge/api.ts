import { authFetch } from "@/core/auth/fetch";
import { getBackendBaseURL } from "@/core/config";

import type {
  KnowledgeAcceptedResponse,
  KnowledgeBaseListResponse,
  KnowledgeBaseSettingsResponse,
  KnowledgeDocumentDebugPayload,
  KnowledgeDocumentBuildEventsResponse,
  KnowledgeTreeNode,
} from "./types";

type KnowledgeErrorPayload = {
  error?: string;
};

async function readKnowledgeErrorMessage(
  response: Response,
  fallbackMessage: string,
): Promise<string> {
  const payload = (await response
    .json()
    .catch(() => ({}))) as KnowledgeErrorPayload;
  return payload.error ?? `${fallbackMessage}: ${response.statusText}`;
}

async function fetchKnowledgeJson<T>(
  input: RequestInfo | URL,
  fallbackMessage: string,
  init?: RequestInit,
): Promise<T> {
  const response = await authFetch(input, init);
  if (!response.ok) {
    throw new Error(await readKnowledgeErrorMessage(response, fallbackMessage));
  }
  return (await response.json()) as T;
}

async function fetchKnowledgeBlob(
  input: RequestInfo | URL,
  fallbackMessage: string,
  init?: RequestInit,
): Promise<Blob> {
  const response = await authFetch(input, init);
  if (!response.ok) {
    throw new Error(await readKnowledgeErrorMessage(response, fallbackMessage));
  }
  return await response.blob();
}

export async function listThreadKnowledgeBases(
  threadId: string,
): Promise<KnowledgeBaseListResponse> {
  return fetchKnowledgeJson<KnowledgeBaseListResponse>(
    `${getBackendBaseURL()}/api/threads/${threadId}/knowledge/bases`,
    "Failed to load knowledge bases",
  );
}

export async function createThreadKnowledgeBase(
  threadId: string,
  params: {
    name: string;
    description?: string;
    modelName?: string;
    files: File[];
  },
): Promise<KnowledgeAcceptedResponse> {
  const formData = new FormData();
  formData.set("name", params.name);
  if (params.description) {
    formData.set("description", params.description);
  }
  if (params.modelName) {
    formData.set("model_name", params.modelName);
  }
  params.files.forEach((file) => {
    formData.append("files", file);
  });

  return fetchKnowledgeJson<KnowledgeAcceptedResponse>(
    `${getBackendBaseURL()}/api/threads/${threadId}/knowledge/bases`,
    "Failed to create knowledge base",
    {
      method: "POST",
      body: formData,
    },
  );
}

export async function listKnowledgeLibrary(
  threadId?: string,
): Promise<KnowledgeBaseListResponse> {
  const url = new URL(`${getBackendBaseURL()}/api/knowledge/bases`);
  if (threadId) {
    url.searchParams.set("thread_id", threadId);
  }
  return fetchKnowledgeJson<KnowledgeBaseListResponse>(
    url,
    "Failed to load knowledge library",
  );
}

export async function indexUploadedKnowledgeFiles(
  threadId: string,
  params: {
    name?: string;
    description?: string;
    filenames: string[];
    modelName?: string;
  },
): Promise<KnowledgeAcceptedResponse> {
  return fetchKnowledgeJson<KnowledgeAcceptedResponse>(
    `${getBackendBaseURL()}/api/threads/${threadId}/knowledge/index-uploaded`,
    "Failed to index uploaded knowledge files",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: params.name ?? "",
        description: params.description ?? "",
        filenames: params.filenames,
        model_name: params.modelName ?? "",
      }),
    },
  );
}

export async function attachKnowledgeBaseToThread(
  threadId: string,
  knowledgeBaseId: string,
): Promise<KnowledgeBaseListResponse> {
  return fetchKnowledgeJson<KnowledgeBaseListResponse>(
    `${getBackendBaseURL()}/api/threads/${threadId}/knowledge/bases/${knowledgeBaseId}/attach`,
    "Failed to attach knowledge base",
    {
      method: "POST",
    },
  );
}

export async function detachKnowledgeBaseFromThread(
  threadId: string,
  knowledgeBaseId: string,
): Promise<KnowledgeBaseListResponse> {
  return fetchKnowledgeJson<KnowledgeBaseListResponse>(
    `${getBackendBaseURL()}/api/threads/${threadId}/knowledge/bases/${knowledgeBaseId}/attach`,
    "Failed to detach knowledge base",
    {
      method: "DELETE",
    },
  );
}

export async function updateKnowledgeBaseSettings(
  knowledgeBaseId: string,
  params: { previewEnabled: boolean },
): Promise<KnowledgeBaseSettingsResponse> {
  return fetchKnowledgeJson<KnowledgeBaseSettingsResponse>(
    `${getBackendBaseURL()}/api/knowledge/bases/${knowledgeBaseId}/settings`,
    "Failed to update knowledge base settings",
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        preview_enabled: params.previewEnabled,
      }),
    },
  );
}

export async function getKnowledgeDocumentTree(
  threadId: string,
  documentId: string,
): Promise<KnowledgeTreeNode[]> {
  return fetchKnowledgeJson<KnowledgeTreeNode[]>(
    `${getBackendBaseURL()}/api/threads/${threadId}/knowledge/documents/${documentId}/tree`,
    "Failed to load document tree",
  );
}

export async function getVisibleKnowledgeDocumentTree(
  documentId: string,
): Promise<KnowledgeTreeNode[]> {
  return fetchKnowledgeJson<KnowledgeTreeNode[]>(
    `${getBackendBaseURL()}/api/knowledge/documents/${documentId}/tree`,
    "Failed to load document tree",
  );
}

export async function listKnowledgeDocumentBuildEvents(
  threadId: string,
  documentId: string,
): Promise<KnowledgeDocumentBuildEventsResponse> {
  return fetchKnowledgeJson<KnowledgeDocumentBuildEventsResponse>(
    `${getBackendBaseURL()}/api/threads/${threadId}/knowledge/documents/${documentId}/build-events`,
    "Failed to load knowledge build events",
  );
}

export async function listVisibleKnowledgeDocumentBuildEvents(
  documentId: string,
): Promise<KnowledgeDocumentBuildEventsResponse> {
  return fetchKnowledgeJson<KnowledgeDocumentBuildEventsResponse>(
    `${getBackendBaseURL()}/api/knowledge/documents/${documentId}/build-events`,
    "Failed to load knowledge build events",
  );
}

export async function getKnowledgeDocumentDebugPayload(
  documentId: string,
): Promise<KnowledgeDocumentDebugPayload> {
  return fetchKnowledgeJson<KnowledgeDocumentDebugPayload>(
    `${getBackendBaseURL()}/api/knowledge/documents/${documentId}/debug`,
    "Failed to load knowledge debug payload",
  );
}

export async function loadVisibleKnowledgeDocumentBlob(
  documentId: string,
  variant: "preview" | "source" | "markdown" | "canonical" = "preview",
): Promise<Blob> {
  const url = new URL(
    `${getBackendBaseURL()}/api/knowledge/documents/${documentId}/file`,
  );
  url.searchParams.set("variant", variant);
  return fetchKnowledgeBlob(url, "Failed to load knowledge document file");
}
