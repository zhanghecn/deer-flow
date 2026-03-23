import { getFileName } from "@/core/utils/files";

import { loadHtmlPreviewDocument } from "./html-preview";
import { loadArtifactBlob } from "./loader";
import { loadArtifactContent } from "./loader";

function isHtmlArtifact(filepath: string) {
  return filepath.toLowerCase().endsWith(".html");
}

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
  if (!preview && isHtmlArtifact(filepath)) {
    const html = await loadArtifactContent({
      filepath,
      threadId,
      isMock,
    });
    const rewrittenDocument = await loadHtmlPreviewDocument({
      html,
      filepath,
      threadId,
      isMock,
    });
    const objectURL = URL.createObjectURL(
      new Blob([rewrittenDocument.html], { type: "text/html" }),
    );
    const openedWindow = window.open(
      objectURL,
      "_blank",
      "noopener,noreferrer",
    );

    if (!openedWindow) {
      URL.revokeObjectURL(objectURL);
      rewrittenDocument.objectUrls.forEach((url) => URL.revokeObjectURL(url));
      throw new Error("Failed to open artifact in a new window");
    }

    window.setTimeout(() => {
      URL.revokeObjectURL(objectURL);
      rewrittenDocument.objectUrls.forEach((url) => URL.revokeObjectURL(url));
    }, 60_000);
    return;
  }

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
