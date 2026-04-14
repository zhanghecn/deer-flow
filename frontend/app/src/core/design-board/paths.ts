export const DESIGN_DOCUMENT_PREFIX = "/mnt/user-data/outputs/designs/";
export const DEFAULT_DESIGN_DOCUMENT_PATH = `${DESIGN_DOCUMENT_PREFIX}canvas.op`;
export const DESIGN_DOCUMENT_SUFFIX = ".op";

export function isDesignDocumentPath(path: string): boolean {
  return (
    path.startsWith(DESIGN_DOCUMENT_PREFIX) &&
    path.endsWith(DESIGN_DOCUMENT_SUFFIX)
  );
}
