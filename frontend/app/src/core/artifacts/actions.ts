import { getFileName } from "@/core/utils/files";

import { loadArtifactBlob } from "./loader";

function triggerBrowserDownload(blob: Blob, filename: string) {
  const objectURL = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectURL;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectURL), 1_000);
}

export async function downloadArtifactFile({
  filepath,
  threadId,
  isMock,
}: {
  filepath: string;
  threadId: string;
  isMock?: boolean;
}) {
  const blob = await loadArtifactBlob({
    filepath,
    threadId,
    isMock,
  });
  triggerBrowserDownload(blob, getFileName(filepath));
}

export async function openArtifactInNewWindow({
  filepath,
  threadId,
  isMock,
  preview,
}: {
  filepath: string;
  threadId: string;
  isMock?: boolean;
  preview?: "pdf";
}) {
  const blob = await loadArtifactBlob({
    filepath,
    threadId,
    isMock,
    preview,
  });
  const objectURL = URL.createObjectURL(blob);
  const openedWindow = window.open(objectURL, "_blank", "noopener,noreferrer");

  if (!openedWindow) {
    URL.revokeObjectURL(objectURL);
    throw new Error("Failed to open artifact in a new window");
  }

  window.setTimeout(() => URL.revokeObjectURL(objectURL), 60_000);
}
