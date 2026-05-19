import { getFileName } from "@/core/utils/files";

import { loadArtifactBlob } from "./loader";
import { urlOfArtifact } from "./utils";

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

function openURLInNewWindow(url: string) {
  // Use an anchor as the single open path: Chromium can return null for
  // window.open(..., "noopener") even when it already opened the tab, which
  // makes fallback logic either show a false error or open a duplicate tab.
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
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
    openURLInNewWindow(
      urlOfArtifact({
        filepath,
        threadId,
        isMock,
      }),
    );
    return;
  }

  const blob = await loadArtifactBlob({
    filepath,
    threadId,
    isMock,
    preview,
  });
  const objectURL = URL.createObjectURL(blob);
  openURLInNewWindow(objectURL);
  window.setTimeout(() => URL.revokeObjectURL(objectURL), 60_000);
}
