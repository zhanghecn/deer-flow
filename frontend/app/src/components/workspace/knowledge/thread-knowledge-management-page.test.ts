import { describe, expect, it } from "vitest";

import type { KnowledgeBase } from "@/core/knowledge/types";

import { shouldDeferKnowledgeSelectionUrlSync } from "./thread-knowledge-management-page";

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
        node_count: 1,
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
