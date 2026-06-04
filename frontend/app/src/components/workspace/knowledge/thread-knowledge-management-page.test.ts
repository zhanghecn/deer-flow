import { describe, expect, it } from "vitest";

import type { KnowledgeBase } from "@/core/knowledge/types";

import {
  knowledgeBaseSourceWorkspaceRefreshKey,
  selectDefaultKnowledgeWorkspacePath,
  shouldDeferKnowledgeSelectionUrlSync,
} from "./thread-knowledge-management-page";

function knowledgeBase(
  id: string,
  ownerId: string,
  documentId: string,
): KnowledgeBase {
  return {
    id,
    owner_id: ownerId,
    owner_name: ownerId,
    name: id,
    source_type: "library",
    visibility: "shared",
    preview_enabled: true,
    attached_to_thread: false,
    documents: [
      {
        id: documentId,
        display_name: `${documentId}.md`,
        file_kind: "markdown",
        locator_type: "heading",
        status: "ready",
      },
    ],
  };
}

describe("shouldDeferKnowledgeSelectionUrlSync", () => {
  const bases = [
    knowledgeBase("base-old-a", "owner-1", "doc-old-a"),
    knowledgeBase("base-old-b", "owner-1", "doc-old-b"),
  ];
  const ownerGroups = [{ ownerId: "owner-1" }];

  it("keeps incoming query params while the library is still loading", () => {
    expect(
      shouldDeferKnowledgeSelectionUrlSync({
        isLoading: true,
        knowledgeBases: [],
        ownerGroups: [],
        searchParams: new URLSearchParams("owner=owner-1&base=base-old-a"),
        selectedOwnerId: null,
        selectedBaseId: null,
        selectedDocumentId: null,
      }),
    ).toBe(true);
  });

  it("does not let stale selected state rewrite a resolvable base URL", () => {
    expect(
      shouldDeferKnowledgeSelectionUrlSync({
        isLoading: false,
        knowledgeBases: bases,
        ownerGroups,
        searchParams: new URLSearchParams("owner=owner-1&base=base-old-a"),
        selectedOwnerId: "owner-1",
        selectedBaseId: "base-old-b",
        selectedDocumentId: "doc-old-b",
      }),
    ).toBe(true);
  });

  it("allows a local click to replace the previously selected base URL", () => {
    expect(
      shouldDeferKnowledgeSelectionUrlSync({
        isLoading: false,
        knowledgeBases: bases,
        ownerGroups,
        searchParams: new URLSearchParams("owner=owner-1&base=base-old-a"),
        selectedOwnerId: "owner-1",
        selectedBaseId: "base-old-b",
        selectedDocumentId: "doc-old-b",
        hasLocalSelectionChange: true,
      }),
    ).toBe(false);
  });

  it("lets document deep links win over a stale base query during hydration", () => {
    expect(
      shouldDeferKnowledgeSelectionUrlSync({
        isLoading: false,
        knowledgeBases: bases,
        ownerGroups,
        searchParams: new URLSearchParams(
          "owner=owner-1&base=base-old-a&document=doc-old-b",
        ),
        selectedOwnerId: "owner-1",
        selectedBaseId: "base-old-a",
        selectedDocumentId: "doc-old-a",
      }),
    ).toBe(true);
  });

  it("allows cleanup when the URL points at a base that no longer exists", () => {
    expect(
      shouldDeferKnowledgeSelectionUrlSync({
        isLoading: false,
        knowledgeBases: bases,
        ownerGroups,
        searchParams: new URLSearchParams("owner=owner-1&base=missing-base"),
        selectedOwnerId: "owner-1",
        selectedBaseId: "base-old-a",
        selectedDocumentId: "doc-old-a",
      }),
    ).toBe(false);
  });
});

describe("selectDefaultKnowledgeWorkspacePath", () => {
  it("opens a source index when one exists", () => {
    expect(
      selectDefaultKnowledgeWorkspacePath([
        { name: "case.md", path: "sources/case.md", is_dir: false },
        { name: "index.md", path: "sources/index.md", is_dir: false },
      ]),
    ).toBe("sources/index.md");
  });

  it("falls back to the first source markdown file", () => {
    expect(
      selectDefaultKnowledgeWorkspacePath([
        { name: "schema.json", path: "schema.json", is_dir: false },
        { name: "case.md", path: "sources/case.md", is_dir: false },
      ]),
    ).toBe("sources/case.md");
  });
});

describe("knowledgeBaseSourceWorkspaceRefreshKey", () => {
  it("changes when source workspace readiness fields change", () => {
    const base = knowledgeBase("base-refresh", "owner-1", "doc-refresh");
    const baseDocument = base.documents[0];
    if (!baseDocument) {
      throw new Error("Expected fixture base to contain one document.");
    }
    const initialKey = knowledgeBaseSourceWorkspaceRefreshKey(base);

    const processingBase: KnowledgeBase = {
      ...base,
      documents: [
        {
          ...baseDocument,
          status: "processing",
          latest_build_job: {
            id: "job-1",
            status: "processing",
            stage: "workspace",
            progress_percent: 99,
            total_steps: 1,
            completed_steps: 0,
            updated_at: "2026-06-04T10:00:00Z",
          },
        },
      ],
    };
    const processingDocument = processingBase.documents[0];
    if (!processingDocument?.latest_build_job) {
      throw new Error("Expected processing fixture to contain a build job.");
    }
    expect(knowledgeBaseSourceWorkspaceRefreshKey(processingBase)).not.toBe(
      initialKey,
    );

    const readyBase: KnowledgeBase = {
      ...processingBase,
      documents: [
        {
          ...processingDocument,
          status: "ready",
          canonical_storage_path: "s3://knowledge/doc/canonical.md",
          latest_build_job: {
            ...processingDocument.latest_build_job,
            status: "ready",
            stage: "completed",
            completed_steps: 1,
            progress_percent: 100,
            updated_at: "2026-06-04T10:00:05Z",
          },
        },
      ],
    };
    expect(knowledgeBaseSourceWorkspaceRefreshKey(readyBase)).not.toBe(
      knowledgeBaseSourceWorkspaceRefreshKey(processingBase),
    );
  });
});
