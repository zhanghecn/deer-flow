import { urlOfArtifact } from "./utils";

const PREVIEW_BASE_URL = "https://preview.local";

export const THREAD_ROOT_PREFIX = "/mnt/user-data";

const ROOT_SCOPES = [
  "outputs",
  "workspace",
  "tmp",
  "uploads",
  "agents",
  "authoring",
] as const;

function decodeURLPath(pathname: string) {
  try {
    return decodeURI(pathname);
  } catch {
    return pathname;
  }
}

function isExternalURL(value: string) {
  return /^(?:[a-z][a-z\d+\-.]*:|\/\/|#)/i.test(value);
}

function normalizeThreadVirtualPath(filepath: string) {
  const trimmed = filepath.trim().replace(/\\/g, "/");
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith(THREAD_ROOT_PREFIX)) {
    return decodeURLPath(new URL(trimmed, PREVIEW_BASE_URL).pathname);
  }

  return decodeURLPath(
    new URL(
      `${THREAD_ROOT_PREFIX}/${trimmed.replace(/^\/+/, "")}`,
      PREVIEW_BASE_URL,
    ).pathname,
  );
}

export function resolveThreadScopedPath(
  reference: string,
  currentFilepath: string,
) {
  const candidate = reference.trim().replace(/\\/g, "/");
  if (!candidate || isExternalURL(candidate)) {
    return null;
  }

  if (candidate.startsWith(THREAD_ROOT_PREFIX)) {
    return decodeURLPath(new URL(candidate, PREVIEW_BASE_URL).pathname);
  }

  const withoutLeadingSlash = candidate.replace(/^\/+/, "");
  for (const scope of ROOT_SCOPES) {
    if (
      withoutLeadingSlash === scope ||
      withoutLeadingSlash.startsWith(`${scope}/`)
    ) {
      return `${THREAD_ROOT_PREFIX}/${withoutLeadingSlash}`;
    }

    if (candidate === `../${scope}` || candidate.startsWith(`../${scope}/`)) {
      return `${THREAD_ROOT_PREFIX}/${candidate.slice(3)}`;
    }
  }

  const baseFilepath = normalizeThreadVirtualPath(currentFilepath);
  if (!baseFilepath) {
    return null;
  }

  const lastSlashIndex = baseFilepath.lastIndexOf("/");
  const baseDir =
    lastSlashIndex >= 0 ? baseFilepath.slice(0, lastSlashIndex + 1) : "/";
  const resolved = decodeURLPath(
    new URL(candidate, `${PREVIEW_BASE_URL}${baseDir}`).pathname,
  );

  if (
    resolved !== THREAD_ROOT_PREFIX &&
    !resolved.startsWith(`${THREAD_ROOT_PREFIX}/`)
  ) {
    return null;
  }

  return resolved;
}

export function resolveArtifactPreviewURL({
  reference,
  filepath,
  threadId,
  isMock,
}: {
  reference: string;
  filepath: string;
  threadId: string;
  isMock?: boolean;
}) {
  const resolved = resolveThreadScopedPath(reference, filepath);
  if (!resolved) {
    return reference;
  }

  return urlOfArtifact({
    filepath: resolved,
    threadId,
    isMock,
  });
}
