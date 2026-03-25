export function setPdfPreviewPage(src: string, pageNumber?: number) {
  const baseSrc = src.replace(/#.*$/, "");
  if (!pageNumber || pageNumber < 1) {
    return baseSrc;
  }
  return `${baseSrc}#page=${pageNumber}`;
}
