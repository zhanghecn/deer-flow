import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { KnowledgeBaseUploadDialog } from "./knowledge-base-upload-dialog";

const createThreadKnowledgeBase = vi.fn();
const createKnowledgeBase = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("@/core/i18n/hooks", () => ({
  useI18n: () => ({
    t: {
      common: {
        cancel: "Cancel",
        create: "Create",
        loading: "Loading",
      },
      knowledge: {
        chooseAtLeastOneFile: "Choose at least one file.",
        invalidSelectedModel:
          "Select a valid model before creating a knowledge base.",
        defaultBaseName: "Knowledge Base",
        createError: "Failed to create knowledge base.",
        indexQueued: "Knowledge indexing has been queued.",
        newTitle: "New Knowledge Base",
        newDescription: "Thread upload",
        newDescriptionGlobal: "Library upload",
        modelLabel: "Index model",
        modelPlaceholder: "Select a model",
        namePlaceholder: "Knowledge base name",
        descriptionPlaceholder: "Optional description for the agent",
      },
    },
  }),
}));

vi.mock("@/core/models/hooks", () => ({
  useModels: () => ({
    models: [
      {
        id: "model-1",
        name: "kimi-k2.5",
        display_name: "Kimi K2.5",
      },
      {
        id: "model-2",
        name: "qwen-max",
        display_name: "Qwen Max",
      },
    ],
    isLoading: false,
    error: null,
  }),
}));

vi.mock("@/core/settings", () => ({
  getLocalSettings: () => ({
    notification: {
      enabled: true,
    },
    context: {
      model_name: "kimi-k2.5",
      mode: "pro",
      agent_status: "dev",
    },
    layout: {
      sidebar_collapsed: false,
    },
  }),
}));

vi.mock("@/core/knowledge/api", () => ({
  createThreadKnowledgeBase: (...args: unknown[]) =>
    createThreadKnowledgeBase(...args),
  createKnowledgeBase: (...args: unknown[]) => createKnowledgeBase(...args),
}));

beforeAll(() => {
  if (!HTMLElement.prototype.hasPointerCapture) {
    HTMLElement.prototype.hasPointerCapture = () => false;
  }
  if (!HTMLElement.prototype.setPointerCapture) {
    HTMLElement.prototype.setPointerCapture = () => {};
  }
  if (!HTMLElement.prototype.releasePointerCapture) {
    HTMLElement.prototype.releasePointerCapture = () => {};
  }
});

describe("KnowledgeBaseUploadDialog", () => {
  it("submits the explicitly selected model for thread knowledge creation", async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    createThreadKnowledgeBase.mockResolvedValue({
      knowledge_base_id: "kb-1",
      thread_id: "thread-1",
      status: "queued",
    });

    render(
      <QueryClientProvider client={queryClient}>
        <KnowledgeBaseUploadDialog
          threadId="thread-1"
          open
          onOpenChange={vi.fn()}
          defaultModelName="kimi-k2.5"
        />
      </QueryClientProvider>,
    );

    await screen.findByText("Kimi K2.5");

    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Qwen Max" }));

    const fileInput =
      document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(fileInput).not.toBeNull();

    await user.upload(
      fileInput!,
      new File(["contract text"], "contract.pdf", {
        type: "application/pdf",
      }),
    );

    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(createThreadKnowledgeBase).toHaveBeenCalledWith(
        "thread-1",
        expect.objectContaining({
          name: "contract",
          description: "",
          modelName: "qwen-max",
          files: [
            expect.objectContaining({
              name: "contract.pdf",
            }),
          ],
        }),
      );
    });
  });
});
