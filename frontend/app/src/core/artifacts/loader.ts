import type { BaseStream } from "@langchain/langgraph-sdk/react";

import { authFetch } from "../auth/fetch";
import {
  loadVisibleKnowledgeDocumentAssetBlob,
  loadVisibleKnowledgeDocumentBlob,
} from "../knowledge/api";
import { parseKnowledgeVirtualPath } from "../knowledge/virtual-paths";
import type { AgentThreadState } from "../threads";

import { urlOfArtifact } from "./utils";

function resolveArtifactErrorMessage(
  payload: { error?: string },
  fallback: string,
) {
  return payload.error ?? fallback;
}

async function fetchArtifactResponse({
  filepath,
  threadId,
  isMock,
  download,
  preview,
}: {
  filepath: string;
  threadId: string;
  isMock?: boolean;
  download?: boolean;
  preview?: "pdf";
}) {
  const url = urlOfArtifact({ filepath, threadId, isMock, download, preview });
  const response = await authFetch(url);
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(
      resolveArtifactErrorMessage(
        payload,
        `Failed to load artifact: ${response.statusText}`,
      ),
    );
  }
  return response;
}

export async function loadArtifactContent({
  filepath,
  threadId,
  isMock,
}: {
  filepath: string;
  threadId: string;
  isMock?: boolean;
}) {
  let enhancedFilepath = filepath;
  if (filepath.endsWith(".skill")) {
    enhancedFilepath = filepath + "/SKILL.md";
  }
  const knowledgePath = parseKnowledgeVirtualPath(enhancedFilepath);
  if (knowledgePath) {
    const blob = knowledgePath.isAsset
      ? await loadVisibleKnowledgeDocumentAssetBlob(
          knowledgePath.documentId,
          knowledgePath.relativePath,
          knowledgePath.variant,
        )
      : await loadVisibleKnowledgeDocumentBlob(
          knowledgePath.documentId,
          knowledgePath.variant,
        );
    return blob.text();
  }
  const response = await fetchArtifactResponse({
    filepath: enhancedFilepath,
    threadId,
    isMock,
  });
  const text = await response.text();
  return text;
}

export async function loadArtifactBlob({
  filepath,
  threadId,
  isMock,
  download,
  preview,
}: {
  filepath: string;
  threadId: string;
  isMock?: boolean;
  download?: boolean;
  preview?: "pdf";
}) {
  const knowledgePath = parseKnowledgeVirtualPath(filepath);
  if (knowledgePath) {
    if (download && knowledgePath.isAsset) {
      return loadVisibleKnowledgeDocumentAssetBlob(
        knowledgePath.documentId,
        knowledgePath.relativePath,
        knowledgePath.variant,
      );
    }
    if (knowledgePath.isAsset) {
      return loadVisibleKnowledgeDocumentAssetBlob(
        knowledgePath.documentId,
        knowledgePath.relativePath,
        knowledgePath.variant,
      );
    }
    return loadVisibleKnowledgeDocumentBlob(
      knowledgePath.documentId,
      knowledgePath.variant,
    );
  }
  const response = await fetchArtifactResponse({
    filepath,
    threadId,
    isMock,
    download,
    preview,
  });
  return response.blob();
}

export function loadArtifactContentFromToolCall({
  url: urlString,
  thread,
}: {
  url: string;
  thread: BaseStream<AgentThreadState>;
}) {
  const url = new URL(urlString);
  const toolCallId = url.searchParams.get("tool_call_id");
  const messageId = url.searchParams.get("message_id");
  if (messageId && toolCallId) {
    const message = thread.messages.find((message) => message.id === messageId);
    if (message?.type === "ai" && message.tool_calls) {
      const toolCall = message.tool_calls.find(
        (toolCall) => toolCall.id === toolCallId,
      );
      if (toolCall) {
        return toolCall.args.content;
      }
    }
  }
}
