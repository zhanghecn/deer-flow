import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/core/i18n/context";

import { KnowledgeSelectorDialog } from "./knowledge-selector-dialog";

vi.mock("@/core/knowledge/hooks", () => ({
  useKnowledgeLibrary: () => ({
    knowledgeBases: [
      {
        id: "kb-1",
        owner_id: "user-1",
        owner_name: "admin",
        name: "E210郑民生-民间盲派八字",
        description: "demo",
        source_type: "library",
        visibility: "shared",
        preview_enabled: true,
        attached_to_thread: false,
        documents: [
          {
            id: "doc-1",
            display_name: "E210郑民生-民间盲派八字.md",
            file_kind: "markdown",
            locator_type: "heading",
            status: "ready",
            doc_description: "排歌命理技法",
            node_count: 1,
          },
        ],
      },
    ],
    isLoading: false,
    error: null,
  }),
}));

vi.mock("@/core/knowledge/api", () => ({
  attachKnowledgeBaseToThread: vi.fn().mockResolvedValue({
    knowledge_bases: [],
  }),
}));

describe("KnowledgeSelectorDialog", () => {
  it("shows the selected knowledge count when the dialog opens", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
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
            <KnowledgeSelectorDialog
              threadId="draft-thread"
              value={[
                {
                  documentId: "doc-1",
                  documentName: "E210郑民生-民间盲派八字.md",
                  knowledgeBaseId: "kb-1",
                  knowledgeBaseName: "E210郑民生-民间盲派八字",
                  ownerName: "admin",
                },
              ]}
              onChange={onChange}
            />
          </I18nProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: /1 knowledge doc/i }));
    expect(screen.getAllByText(/1 knowledge doc/i).length).toBeGreaterThan(0);
  });
});
