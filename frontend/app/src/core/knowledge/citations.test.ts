import { describe, expect, it } from "vitest";

import { parseKnowledgeCitationHref } from "./citations";

describe("parseKnowledgeCitationHref", () => {
  it("preserves page-based artifact paths", () => {
    const result = parseKnowledgeCitationHref(
      "kb://citation?artifact_path=/mnt/user-data/outputs/.knowledge/doc-1/PRML.pdf&locator_type=page&page=12",
    );

    expect(result?.artifactPath).toBe(
      "/mnt/user-data/outputs/.knowledge/doc-1/PRML.pdf",
    );
    expect(result?.page).toBe(12);
  });

  it("normalizes legacy heading citations to canonical markdown", () => {
    const result = parseKnowledgeCitationHref(
      "kb://citation?artifact_path=/mnt/user-data/outputs/.knowledge/doc-1/%E6%AE%B5%E5%BB%BA%E4%B8%9A%E7%9B%B2%E6%B4%BE%E5%91%BD%E7%90%86%E5%B9%B2%E6%94%AF%E8%A7%A3%E5%AF%86.docx&locator_type=heading&heading=test-heading&line=125",
    );

    expect(result?.artifactPath).toBe(
      "/mnt/user-data/outputs/.knowledge/doc-1/canonical.md",
    );
    expect(result?.heading).toBe("test-heading");
    expect(result?.line).toBe(125);
  });

  it("leaves heading markdown citations untouched", () => {
    const result = parseKnowledgeCitationHref(
      "kb://citation?artifact_path=/mnt/user-data/outputs/.knowledge/doc-1/canonical.md&locator_type=heading&heading=focus-target&line=42",
    );

    expect(result?.artifactPath).toBe(
      "/mnt/user-data/outputs/.knowledge/doc-1/canonical.md",
    );
  });

  it("parses asset citations with a separate image path", () => {
    const result = parseKnowledgeCitationHref(
      "kb://asset?artifact_path=/mnt/user-data/outputs/.knowledge/doc-1/PRML.pdf&asset_path=/mnt/user-data/outputs/.knowledge/doc-1/assets/page-0012.png&locator_type=page&page=12",
    );

    expect(result?.kind).toBe("asset");
    expect(result?.artifactPath).toBe(
      "/mnt/user-data/outputs/.knowledge/doc-1/PRML.pdf",
    );
    expect(result?.assetPath).toBe(
      "/mnt/user-data/outputs/.knowledge/doc-1/assets/page-0012.png",
    );
    expect(result?.page).toBe(12);
  });
});
