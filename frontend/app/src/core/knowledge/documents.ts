import type { KnowledgeBaseListResponse, KnowledgeDocument } from "./types";

type KnowledgeDocumentStatusSource = Pick<
  KnowledgeDocument,
  "status" | "latest_build_job"
>;

export function getKnowledgeDocumentStatus(
  document: KnowledgeDocumentStatusSource,
): string {
  return document.latest_build_job?.status ?? document.status;
}

export function getKnowledgeDocumentProgress(
  document: KnowledgeDocumentStatusSource,
): number {
  return getKnowledgeDocumentStatus(document) === "ready"
    ? 100
    : (document.latest_build_job?.progress_percent ?? 0);
}

export function isKnowledgeDocumentBuildActive(
  document: KnowledgeDocumentStatusSource,
): boolean {
  const status = getKnowledgeDocumentStatus(document);
  return status === "queued" || status === "processing";
}

export function hasActiveKnowledgeBuild(
  data: KnowledgeBaseListResponse | undefined,
): boolean {
  return Boolean(
    data?.knowledge_bases.some((knowledgeBase) =>
      knowledgeBase.documents.some((document) =>
        isKnowledgeDocumentBuildActive(document),
      ),
    ),
  );
}
