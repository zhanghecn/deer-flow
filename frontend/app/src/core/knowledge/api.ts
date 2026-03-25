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

export async function listThreadKnowledgeBases(
  threadId: string,
): Promise<KnowledgeBaseListResponse> {
  const response = await authFetch(
    `${getBackendBaseURL()}/api/threads/${threadId}/knowledge/bases`,
  );
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(
      payload.error ?? `Failed to load knowledge bases: ${response.statusText}`,
    );
  }
  return (await response.json()) as KnowledgeBaseListResponse;
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

  const response = await authFetch(
    `${getBackendBaseURL()}/api/threads/${threadId}/knowledge/bases`,
    {
      method: "POST",
      body: formData,
    },
  );
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(
      payload.error ??
        `Failed to create knowledge base: ${response.statusText}`,
    );
  }
  return (await response.json()) as KnowledgeAcceptedResponse;
}

export async function listKnowledgeLibrary(
  threadId?: string,
): Promise<KnowledgeBaseListResponse> {
  const url = new URL(`${getBackendBaseURL()}/api/knowledge/bases`);
  if (threadId) {
    url.searchParams.set("thread_id", threadId);
  }
  const response = await authFetch(url.toString());
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(
      payload.error ??
        `Failed to load knowledge library: ${response.statusText}`,
    );
  }
  return (await response.json()) as KnowledgeBaseListResponse;
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
  const response = await authFetch(
    `${getBackendBaseURL()}/api/threads/${threadId}/knowledge/index-uploaded`,
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
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(
      payload.error ??
        `Failed to index uploaded knowledge files: ${response.statusText}`,
    );
  }
  return (await response.json()) as KnowledgeAcceptedResponse;
}

export async function attachKnowledgeBaseToThread(
  threadId: string,
  knowledgeBaseId: string,
): Promise<KnowledgeBaseListResponse> {
  const response = await authFetch(
    `${getBackendBaseURL()}/api/threads/${threadId}/knowledge/bases/${knowledgeBaseId}/attach`,
    {
      method: "POST",
    },
  );
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(
      payload.error ??
        `Failed to attach knowledge base: ${response.statusText}`,
    );
  }
  return (await response.json()) as KnowledgeBaseListResponse;
}

export async function detachKnowledgeBaseFromThread(
  threadId: string,
  knowledgeBaseId: string,
): Promise<KnowledgeBaseListResponse> {
  const response = await authFetch(
    `${getBackendBaseURL()}/api/threads/${threadId}/knowledge/bases/${knowledgeBaseId}/attach`,
    {
      method: "DELETE",
    },
  );
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(
      payload.error ??
        `Failed to detach knowledge base: ${response.statusText}`,
    );
  }
  return (await response.json()) as KnowledgeBaseListResponse;
}

export async function updateKnowledgeBaseSettings(
  knowledgeBaseId: string,
  params: { previewEnabled: boolean },
): Promise<KnowledgeBaseSettingsResponse> {
  const response = await authFetch(
    `${getBackendBaseURL()}/api/knowledge/bases/${knowledgeBaseId}/settings`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        preview_enabled: params.previewEnabled,
      }),
    },
  );
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(
      payload.error ??
        `Failed to update knowledge base settings: ${response.statusText}`,
    );
  }
  return (await response.json()) as KnowledgeBaseSettingsResponse;
}

export async function getKnowledgeDocumentTree(
  threadId: string,
  documentId: string,
): Promise<KnowledgeTreeNode[]> {
  const response = await authFetch(
    `${getBackendBaseURL()}/api/threads/${threadId}/knowledge/documents/${documentId}/tree`,
  );
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(
      payload.error ?? `Failed to load document tree: ${response.statusText}`,
    );
  }
  return (await response.json()) as KnowledgeTreeNode[];
}

export async function getVisibleKnowledgeDocumentTree(
  documentId: string,
): Promise<KnowledgeTreeNode[]> {
  const response = await authFetch(
    `${getBackendBaseURL()}/api/knowledge/documents/${documentId}/tree`,
  );
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(
      payload.error ?? `Failed to load document tree: ${response.statusText}`,
    );
  }
  return (await response.json()) as KnowledgeTreeNode[];
}

export async function listKnowledgeDocumentBuildEvents(
  threadId: string,
  documentId: string,
): Promise<KnowledgeDocumentBuildEventsResponse> {
  const response = await authFetch(
    `${getBackendBaseURL()}/api/threads/${threadId}/knowledge/documents/${documentId}/build-events`,
  );
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(
      payload.error ??
        `Failed to load knowledge build events: ${response.statusText}`,
    );
  }
  return (await response.json()) as KnowledgeDocumentBuildEventsResponse;
}

export async function listVisibleKnowledgeDocumentBuildEvents(
  documentId: string,
): Promise<KnowledgeDocumentBuildEventsResponse> {
  const response = await authFetch(
    `${getBackendBaseURL()}/api/knowledge/documents/${documentId}/build-events`,
  );
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(
      payload.error ??
        `Failed to load knowledge build events: ${response.statusText}`,
    );
  }
  return (await response.json()) as KnowledgeDocumentBuildEventsResponse;
}

export async function getKnowledgeDocumentDebugPayload(
  documentId: string,
): Promise<KnowledgeDocumentDebugPayload> {
  const response = await authFetch(
    `${getBackendBaseURL()}/api/knowledge/documents/${documentId}/debug`,
  );
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(
      payload.error ??
        `Failed to load knowledge debug payload: ${response.statusText}`,
    );
  }
  return (await response.json()) as KnowledgeDocumentDebugPayload;
}

export async function loadVisibleKnowledgeDocumentBlob(
  documentId: string,
  variant: "preview" | "source" | "markdown" | "canonical" = "preview",
): Promise<Blob> {
  const url = new URL(
    `${getBackendBaseURL()}/api/knowledge/documents/${documentId}/file`,
  );
  url.searchParams.set("variant", variant);
  const response = await authFetch(url.toString());
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(
      payload.error ??
        `Failed to load knowledge document file: ${response.statusText}`,
    );
  }
  return await response.blob();
}
