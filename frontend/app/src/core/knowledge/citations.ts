export interface KnowledgeCitationTarget {
  artifactPath: string;
  documentId?: string;
  documentName?: string;
  locatorLabel?: string;
  locatorType?: "page" | "heading";
  nodeId?: string;
  page?: number;
  heading?: string;
  line?: number;
}

export function parseKnowledgeCitationHref(
  href: string | null | undefined,
): KnowledgeCitationTarget | null {
  if (!href || !href.startsWith("kb://")) {
    return null;
  }

  try {
    const url = new URL(href);
    const artifactPath = url.searchParams.get("artifact_path")?.trim();
    if (!artifactPath) {
      return null;
    }
    const page = Number.parseInt(url.searchParams.get("page") ?? "", 10);
    const line = Number.parseInt(url.searchParams.get("line") ?? "", 10);
    const locatorType = url.searchParams.get("locator_type");

    return {
      artifactPath,
      documentId: url.searchParams.get("document_id") ?? undefined,
      documentName: url.searchParams.get("document_name") ?? undefined,
      locatorLabel: url.searchParams.get("locator_label") ?? undefined,
      locatorType:
        locatorType === "page" || locatorType === "heading"
          ? locatorType
          : undefined,
      nodeId: url.searchParams.get("node_id") ?? undefined,
      page: Number.isFinite(page) ? page : undefined,
      heading: url.searchParams.get("heading") ?? undefined,
      line: Number.isFinite(line) ? line : undefined,
    };
  } catch {
    return null;
  }
}
