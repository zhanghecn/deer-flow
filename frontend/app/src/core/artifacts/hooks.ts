import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { useThread } from "@/components/workspace/messages/context";

import { listThreadOutputArtifacts } from "./api";
import {
  loadArtifactBlob,
  loadArtifactContent,
  loadArtifactContentFromToolCall,
} from "./loader";

export function useArtifactContent({
  filepath,
  threadId,
  enabled,
}: {
  filepath: string;
  threadId: string;
  enabled?: boolean;
}) {
  const isWriteFile = useMemo(() => {
    return filepath.startsWith("write-file:");
  }, [filepath]);
  const { thread, isMock } = useThread();
  const content = useMemo(() => {
    if (isWriteFile) {
      return loadArtifactContentFromToolCall({ url: filepath, thread });
    }
    return null;
  }, [filepath, isWriteFile, thread]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["artifact", filepath, threadId, isMock],
    queryFn: () => {
      return loadArtifactContent({ filepath, threadId, isMock });
    },
    enabled,
    // Cache artifact content for 5 minutes to avoid repeated fetches (especially for .skill ZIP extraction)
    staleTime: 5 * 60 * 1000,
  });
  return { content: isWriteFile ? content : data, isLoading, error };
}

export function useArtifactObjectUrl({
  filepath,
  threadId,
  enabled,
  preview,
  isMock,
}: {
  filepath: string;
  threadId: string;
  enabled?: boolean;
  preview?: "pdf";
  isMock?: boolean;
}) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ["artifact-blob", filepath, threadId, preview, isMock],
    queryFn: () =>
      loadArtifactBlob({
        filepath,
        threadId,
        preview,
        isMock,
      }),
    enabled,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (!data) {
      setObjectUrl(null);
      return;
    }

    const nextObjectUrl = URL.createObjectURL(data);
    setObjectUrl(nextObjectUrl);

    return () => {
      URL.revokeObjectURL(nextObjectUrl);
    };
  }, [data]);

  return {
    objectUrl,
    blobType: data?.type ?? null,
    isLoading,
    error,
  };
}

export function useThreadOutputArtifacts({
  threadId,
  enabled,
  refreshKey,
  refetchIntervalMs,
}: {
  threadId: string;
  enabled?: boolean;
  refreshKey?: string | number;
  refetchIntervalMs?: number | false;
}) {
  const { data, isLoading, error, dataUpdatedAt } = useQuery({
    queryKey: ["thread-output-artifacts", threadId, refreshKey],
    queryFn: () => listThreadOutputArtifacts(threadId),
    enabled: Boolean(threadId) && enabled,
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchInterval: enabled ? refetchIntervalMs : false,
    refetchIntervalInBackground: false,
  });

  return {
    artifacts: data ?? [],
    isLoading,
    error,
    lastUpdatedAt: dataUpdatedAt,
  };
}
