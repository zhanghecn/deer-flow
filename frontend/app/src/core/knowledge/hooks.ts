import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import {
  getKnowledgeDocumentDebugPayload,
  getKnowledgeDocumentTree,
  getVisibleKnowledgeDocumentTree,
  listKnowledgeDocumentBuildEvents,
  listKnowledgeLibrary,
  listVisibleKnowledgeDocumentBuildEvents,
  loadVisibleKnowledgeDocumentBlob,
  listThreadKnowledgeBases,
} from "./api";
import type { KnowledgeBaseListResponse, KnowledgeDocument } from "./types";

function hasActiveKnowledgeBuild(data: KnowledgeBaseListResponse | undefined) {
  return Boolean(
    data?.knowledge_bases.some((knowledgeBase) =>
      knowledgeBase.documents.some((document) => {
        const status = document.latest_build_job?.status ?? document.status;
        return status === "queued" || status === "processing";
      }),
    ),
  );
}

export function useThreadKnowledgeBases(threadId: string | undefined) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["thread-knowledge-bases", threadId],
    queryFn: () => listThreadKnowledgeBases(threadId ?? ""),
    enabled: Boolean(threadId),
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchInterval: (query) =>
      hasActiveKnowledgeBuild(query.state.data as KnowledgeBaseListResponse)
        ? 2000
        : false,
  });

  return {
    knowledgeBases: data?.knowledge_bases ?? [],
    isLoading,
    error,
  };
}

export function useKnowledgeLibrary(threadId: string | undefined) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["knowledge-library", threadId],
    queryFn: () => listKnowledgeLibrary(threadId),
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchInterval: (query) =>
      hasActiveKnowledgeBuild(query.state.data as KnowledgeBaseListResponse)
        ? 2000
        : false,
  });

  return {
    knowledgeBases: data?.knowledge_bases ?? [],
    isLoading,
    error,
  };
}

export function useKnowledgeDocumentTree(
  threadId: string | undefined,
  documentId: string | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: ["knowledge-document-tree", threadId, documentId],
    queryFn: () => getKnowledgeDocumentTree(threadId ?? "", documentId ?? ""),
    enabled: Boolean(threadId && documentId && enabled),
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function useVisibleKnowledgeDocumentTree(
  documentId: string | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: ["visible-knowledge-document-tree", documentId],
    queryFn: () => getVisibleKnowledgeDocumentTree(documentId ?? ""),
    enabled: Boolean(documentId && enabled),
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function useKnowledgeDocumentBuildEvents(
  threadId: string | undefined,
  document: KnowledgeDocument | null | undefined,
) {
  return useQuery({
    queryKey: ["knowledge-document-build-events", threadId, document?.id],
    queryFn: () =>
      listKnowledgeDocumentBuildEvents(threadId ?? "", document?.id ?? ""),
    enabled: Boolean(threadId && document?.id),
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchInterval: () => {
      const status = document?.latest_build_job?.status ?? document?.status;
      if (status === "queued" || status === "processing") {
        return 2000;
      }
      return false;
    },
  });
}

export function useVisibleKnowledgeDocumentBuildEvents(
  document: KnowledgeDocument | null | undefined,
) {
  return useQuery({
    queryKey: ["visible-knowledge-document-build-events", document?.id],
    queryFn: () => listVisibleKnowledgeDocumentBuildEvents(document?.id ?? ""),
    enabled: Boolean(document?.id),
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchInterval: () => {
      const status = document?.latest_build_job?.status ?? document?.status;
      if (status === "queued" || status === "processing") {
        return 2000;
      }
      return false;
    },
  });
}

export function useKnowledgeDocumentDebug(
  documentId: string | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: ["knowledge-document-debug", documentId],
    queryFn: () => getKnowledgeDocumentDebugPayload(documentId ?? ""),
    enabled: Boolean(documentId && enabled),
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
}

export function useVisibleKnowledgeDocumentObjectUrl({
  documentId,
  enabled = true,
  variant = "preview",
}: {
  documentId: string | undefined;
  enabled?: boolean;
  variant?: "preview" | "source" | "markdown" | "canonical";
}) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ["visible-knowledge-document-blob", documentId, variant],
    queryFn: () => loadVisibleKnowledgeDocumentBlob(documentId ?? "", variant),
    enabled: Boolean(documentId && enabled),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!data) {
      setObjectUrl(null);
      return;
    }

    const nextObjectUrl = URL.createObjectURL(data);
    setObjectUrl(nextObjectUrl);
    return () => URL.revokeObjectURL(nextObjectUrl);
  }, [data]);

  return {
    objectUrl,
    blobType: data?.type ?? null,
    isLoading,
    error,
  };
}
