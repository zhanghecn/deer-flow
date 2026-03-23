import { getBackendBaseURL } from "../config";
import type { AgentThread } from "../threads";

function stripArtifactExtension(filepath: string) {
  return filepath.replace(/\.[^/.]+$/, "");
}

function isPowerPointArtifact(filepath: string) {
  const normalized = filepath.toLowerCase();
  return normalized.endsWith(".ppt") || normalized.endsWith(".pptx");
}

function isHtmlArtifact(filepath: string) {
  return filepath.toLowerCase().endsWith(".html");
}

function encodeArtifactPath(filepath: string) {
  return filepath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function normalizeEncodedArtifactPath(filepath: string) {
  const encodedPath = encodeArtifactPath(filepath);
  return encodedPath.startsWith("/") ? encodedPath : `/${encodedPath}`;
}

export function filterLegacyPptPreviewArtifacts(filepaths: string[]) {
  const powerpointArtifacts = new Set(
    filepaths
      .filter(isPowerPointArtifact)
      .map((filepath) => stripArtifactExtension(filepath).toLowerCase()),
  );

  return filepaths.filter((filepath) => {
    if (!isHtmlArtifact(filepath)) {
      return true;
    }
    return !powerpointArtifacts.has(
      stripArtifactExtension(filepath).toLowerCase(),
    );
  });
}

export function mergeVisibleArtifacts(
  prioritized: string[],
  discovered: string[],
) {
  return filterLegacyPptPreviewArtifacts(
    Array.from(
      new Set(
        [...prioritized, ...discovered].filter(
          (filepath): filepath is string =>
            typeof filepath === "string" && filepath.trim().length > 0,
        ),
      ),
    ),
  );
}

export function urlOfArtifact({
  filepath,
  threadId,
  download = false,
  preview,
  isMock = false,
}: {
  filepath: string;
  threadId: string;
  download?: boolean;
  preview?: "pdf";
  isMock?: boolean;
}) {
  const params = new URLSearchParams();
  if (download) {
    params.set("download", "true");
  }
  if (preview) {
    params.set("preview", preview);
  }
  const query = params.toString();
  const suffix = query ? `?${query}` : "";
  const encodedPath = normalizeEncodedArtifactPath(filepath);

  if (isMock) {
    return `${getBackendBaseURL()}/mock/api/threads/${threadId}/artifacts${encodedPath}${suffix}`;
  }
  return `${getBackendBaseURL()}/api/threads/${threadId}/artifacts${encodedPath}${suffix}`;
}

export function urlOfOnlyOfficeConfig({
  filepath,
  threadId,
  mode,
}: {
  filepath: string;
  threadId: string;
  mode: "view" | "edit";
}) {
  const encodedPath = normalizeEncodedArtifactPath(filepath);
  const params = new URLSearchParams({ mode });
  return `${getBackendBaseURL()}/api/threads/${threadId}/office-config${encodedPath}?${params.toString()}`;
}

export function extractArtifactsFromThread(thread: AgentThread) {
  return filterLegacyPptPreviewArtifacts(thread.values.artifacts ?? []);
}

export function resolveArtifactURL(absolutePath: string, threadId: string) {
  return `${getBackendBaseURL()}/api/threads/${threadId}/artifacts${normalizeEncodedArtifactPath(absolutePath)}`;
}
