import { describe, expect, it } from "vitest";

import { parseKnowledgeVirtualPath } from "./virtual-paths";

describe("parseKnowledgeVirtualPath", () => {
  it("parses canonical markdown knowledge paths", () => {
    const result = parseKnowledgeVirtualPath(
      "/mnt/user-data/outputs/.knowledge/doc-1/canonical.md",
    );

    expect(result).toEqual({
      documentId: "doc-1",
      relativePath: "canonical.md",
      isAsset: false,
      variant: "canonical",
    });
  });

  it("maps pdf knowledge paths to preview variant", () => {
    const result = parseKnowledgeVirtualPath(
      "/mnt/user-data/outputs/.knowledge/doc-2/PRML.pdf",
    );

    expect(result).toEqual({
      documentId: "doc-2",
      relativePath: "PRML.pdf",
      isAsset: false,
      variant: "preview",
    });
  });

  it("recognizes nested knowledge assets", () => {
    const result = parseKnowledgeVirtualPath(
      "/mnt/user-data/outputs/.knowledge/doc-3/images/cover.png",
    );

    expect(result).toEqual({
      documentId: "doc-3",
      relativePath: "images/cover.png",
      isAsset: true,
      variant: "source",
    });
  });
});
