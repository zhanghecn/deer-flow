import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/core/i18n/context";

import {
  KnowledgeSelectorDialog,
  resolveKnowledgeBaseBindingDiff,
} from "./knowledge-selector-dialog";

vi.mock("@/core/knowledge/hooks", () => ({
  useKnowledgeLibrary: () => ({
    knowledgeBases: [
      {
        id: "kb-1",
        owner_id: "user-1",
        owner_name: "admin",
        name: "Attached Base",
        description: "already attached",
        source_type: "library",
        visibility: "shared",
        preview_enabled: true,
        attached_to_thread: true,
        documents: [
          {
            id: "doc-1",
            display_name: "attached.pdf",
            file_kind: "pdf",
            locator_type: "page",
            status: "ready",
            doc_description: "attached document",
            node_count: 1,
          },
        ],
      },
      {
        id: "kb-2",
        owner_id: "user-1",
        owner_name: "admin",
        name: "Detached Base",
        description: "not attached yet",
        source_type: "library",
        visibility: "shared",
        preview_enabled: true,
        attached_to_thread: false,
        documents: [
          {
            id: "doc-2",
            display_name: "detached.md",
            file_kind: "markdown",
            locator_type: "heading",
            status: "ready",
            doc_description: "detached document",
            node_count: 1,
          },
        ],
      },
    ],
    isLoading: false,
    error: null,
  }),
}));

describe("KnowledgeSelectorDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the attached knowledge base count on the trigger", () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <I18nProvider initialLocale="en-US">
            <KnowledgeSelectorDialog threadId="draft-thread" />
          </I18nProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("button", { name: /1 knowledge base/i }),
    ).toBeInTheDocument();
  });

  it("keeps the checked state separate from command focus state", async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <I18nProvider initialLocale="en-US">
            <KnowledgeSelectorDialog threadId="draft-thread" />
          </I18nProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: /1 knowledge base/i }));

    const attachedBase = screen
      .getByText("Attached Base")
      .closest('[cmdk-item=""]');
    const detachedBase = screen
      .getByText("Detached Base")
      .closest('[cmdk-item=""]');

    expect(attachedBase).toHaveAttribute("aria-checked", "true");
    expect(attachedBase).toHaveAttribute("data-checked", "true");
    expect(detachedBase).toHaveAttribute("aria-checked", "false");
    expect(detachedBase).toHaveAttribute("data-checked", "false");
  });

  it("computes the full attach and detach diff from thread bindings", () => {
    expect(
      resolveKnowledgeBaseBindingDiff(["kb-1", "kb-3"], ["kb-2", "kb-3"]),
    ).toEqual({
      baseIdsToAttach: ["kb-2"],
      baseIdsToDetach: ["kb-1"],
    });
  });
});
