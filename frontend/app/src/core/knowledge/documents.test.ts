import { describe, expect, it } from "vitest";

import {
  getKnowledgeDocumentProgress,
  getKnowledgeDocumentStatus,
  hasActiveKnowledgeBuild,
  isKnowledgeDocumentBuildActive,
} from "./documents";
import type { KnowledgeBaseListResponse, KnowledgeDocument } from "./types";

function createDocument(
  overrides: Partial<KnowledgeDocument> = {},
): KnowledgeDocument {
  return {
    id: "doc-1",
    display_name: "doc.md",
    file_kind: "markdown",
    locator_type: "heading",
    status: "ready",
    node_count: 1,
    ...overrides,
  };
}

describe("knowledge document helpers", () => {
  it("prefers build job status over persisted document status", () => {
    const document = createDocument({
      status: "ready",
      latest_build_job: {
        id: "job-1",
        status: "processing",
        progress_percent: 42,
        total_steps: 10,
        completed_steps: 4,
      },
    });

    expect(getKnowledgeDocumentStatus(document)).toBe("processing");
    expect(getKnowledgeDocumentProgress(document)).toBe(42);
    expect(isKnowledgeDocumentBuildActive(document)).toBe(true);
  });

  it("normalizes ready documents to full progress", () => {
    const document = createDocument({
      status: "ready",
      latest_build_job: {
        id: "job-1",
        status: "ready",
        progress_percent: 12,
        total_steps: 10,
        completed_steps: 10,
      },
    });

    expect(getKnowledgeDocumentProgress(document)).toBe(100);
    expect(isKnowledgeDocumentBuildActive(document)).toBe(false);
  });

  it("detects active builds across the library response", () => {
    const response: KnowledgeBaseListResponse = {
      knowledge_bases: [
        {
          id: "kb-1",
          owner_id: "user-1",
          owner_name: "alice",
          name: "Research",
          source_type: "sidebar",
          visibility: "shared",
          preview_enabled: true,
          attached_to_thread: false,
          documents: [
            createDocument({
              id: "doc-1",
              status: "queued",
            }),
          ],
        },
      ],
    };

    expect(hasActiveKnowledgeBuild(response)).toBe(true);
  });
});
