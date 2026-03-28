export interface KnowledgeCitationTarget {
  kind: "citation" | "asset";
  artifactPath: string;
  assetPath?: string;
  documentId?: string;
  documentName?: string;
  locatorLabel?: string;
  locatorType?: "page" | "heading";
  nodeId?: string;
  page?: number;
  heading?: string;
  line?: number;
}

const HEADING_CANONICAL_FALLBACK_EXTENSIONS = new Set([
  ".doc",
  ".docx",
  ".ppt",
  ".pptx",
  ".xls",
  ".xlsx",
]);

function normalizeHeadingArtifactPath(artifactPath: string): string {
  const normalizedPath = artifactPath.trim();
  if (!normalizedPath) {
    return normalizedPath;
  }

  const lowerPath = normalizedPath.toLowerCase();
  if (
    lowerPath.endsWith("/canonical.md") ||
    lowerPath.endsWith("/canonical.markdown")
  ) {
    return normalizedPath;
  }

  const slashIndex = normalizedPath.lastIndexOf("/");
  const fileName =
    slashIndex >= 0 ? normalizedPath.slice(slashIndex + 1) : normalizedPath;
  const dotIndex = fileName.lastIndexOf(".");
  const extension = dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : "";
  if (!HEADING_CANONICAL_FALLBACK_EXTENSIONS.has(extension)) {
    return normalizedPath;
  }

  const directory = slashIndex >= 0 ? normalizedPath.slice(0, slashIndex) : "";
  return directory ? `${directory}/canonical.md` : "canonical.md";
}

export function parseKnowledgeCitationHref(
  href: string | null | undefined,
): KnowledgeCitationTarget | null {
  if (!href || !href.startsWith("kb://")) {
    return null;
  }

  try {
    const url = new URL(href);
    const kind = url.hostname === "asset" ? "asset" : "citation";
    const artifactPath = url.searchParams.get("artifact_path")?.trim();
    if (!artifactPath) {
      return null;
    }
    const page = Number.parseInt(url.searchParams.get("page") ?? "", 10);
    const line = Number.parseInt(url.searchParams.get("line") ?? "", 10);
    const locatorType = url.searchParams.get("locator_type");

    const normalizedArtifactPath =
      (locatorType === "heading"
        ? normalizeHeadingArtifactPath(artifactPath)
        : artifactPath) || artifactPath;

    return {
      kind,
      artifactPath: normalizedArtifactPath,
      assetPath: url.searchParams.get("asset_path") ?? undefined,
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
