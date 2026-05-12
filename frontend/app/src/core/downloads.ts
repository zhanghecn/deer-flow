export function extractFilenameFromContentDisposition(
  headerValue: string | null,
) {
  if (!headerValue) {
    return null;
  }
  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(headerValue);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1]);
  }
  const plainMatch = /filename=\"?([^\";]+)\"?/i.exec(headerValue);
  return plainMatch?.[1] ?? null;
}

export function triggerBrowserDownload(blob: Blob, filename: string) {
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
