import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ThreadKnowledgeAttachmentStrip } from "./thread-knowledge-attachment-strip";

vi.mock("@/core/i18n/hooks", () => ({
  useI18n: () => ({
    t: {
      knowledge: {
        loadingAttached: "Loading attached knowledge...",
        attachedBaseCount: (count: number) =>
          `${count} attached base${count === 1 ? "" : "s"}`,
        documentCount: (count: number) =>
          `${count} document${count === 1 ? "" : "s"}`,
        status: {
          queued: "Queued",
          ready: "Ready",
          processing: "Indexing",
          error: "Error",
        },
      },
    },
  }),
}));

vi.mock("@/core/knowledge/hooks", () => ({
  useThreadKnowledgeBases: () => ({
    knowledgeBases: [
      {
        id: "kb-1",
        owner_id: "user-1",
        owner_name: "admin",
        name: "中文合同陷阱测试包",
        description: "demo",
        source_type: "sidebar",
        visibility: "private",
        preview_enabled: true,
        attached_to_thread: true,
        documents: [
          {
            id: "doc-1",
            display_name: "01_construction_killer_clauses.pdf",
            file_kind: "pdf",
            locator_type: "page",
            status: "queued",
            node_count: 0,
            latest_build_job: {
              id: "job-1",
              status: "processing",
              progress_percent: 42,
              total_steps: 10,
              completed_steps: 4,
            },
          },
        ],
      },
    ],
    isLoading: false,
    error: null,
  }),
}));

describe("ThreadKnowledgeAttachmentStrip", () => {
  it("renders attached knowledge bases with live indexing progress", () => {
    render(<ThreadKnowledgeAttachmentStrip threadId="thread-1" />);

    expect(screen.getByText("1 attached base")).toBeInTheDocument();
    expect(screen.getByText("中文合同陷阱测试包")).toBeInTheDocument();
    expect(screen.getByText("Indexing 42%")).toBeInTheDocument();
    expect(
      screen.getByText("01_construction_killer_clauses.pdf"),
    ).toBeInTheDocument();
  });
});
