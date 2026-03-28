import type { VisibleKnowledgeDocumentVariant } from "./api";

const KNOWLEDGE_VIRTUAL_PREFIX = "/mnt/user-data/outputs/.knowledge/";

export interface KnowledgeVirtualPathTarget {
  documentId: string;
  relativePath: string;
  isAsset: boolean;
  variant: VisibleKnowledgeDocumentVariant;
}

export function parseKnowledgeVirtualPath(
  filepath: string,
): KnowledgeVirtualPathTarget | null {
  const normalizedPath = filepath.trim().replace(/\\/g, "/");
  if (!normalizedPath.startsWith(KNOWLEDGE_VIRTUAL_PREFIX)) {
    return null;
  }

  const remainder = normalizedPath.slice(KNOWLEDGE_VIRTUAL_PREFIX.length);
  const separatorIndex = remainder.indexOf("/");
  if (separatorIndex <= 0 || separatorIndex === remainder.length - 1) {
    return null;
  }

  const documentId = remainder.slice(0, separatorIndex).trim();
  const relativePath = remainder.slice(separatorIndex + 1).trim();
  if (!documentId || !relativePath) {
    return null;
  }

  return {
    documentId,
    relativePath,
    isAsset: relativePath.includes("/"),
    variant: inferKnowledgeDocumentVariant(relativePath),
  };
}

function inferKnowledgeDocumentVariant(
  relativePath: string,
): VisibleKnowledgeDocumentVariant {
  const lowerPath = relativePath.toLowerCase();
  if (
    lowerPath === "canonical.md" ||
    lowerPath === "canonical.markdown" ||
    lowerPath.endsWith("/canonical.md") ||
    lowerPath.endsWith("/canonical.markdown")
  ) {
    return "canonical";
  }
  if (lowerPath.endsWith(".pdf")) {
    return "preview";
  }
  return "source";
}
