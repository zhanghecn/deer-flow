import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { KnowledgeBaseUploadDialog } from "./knowledge-base-upload-dialog";

const createThreadKnowledgeBase = vi.fn();
const createKnowledgeBase = vi.fn();
const ensureThreadExists = vi.fn();

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
      },
      knowledge: {
        chooseAtLeastOneFile: "Choose at least one file.",
        defaultBaseName: "Knowledge Base",
        createError: "Failed to create knowledge base.",
        preparationQueued: "Knowledge source preparation has been queued.",
        newTitle: "New Knowledge Base",
        newDescription: "Thread upload",
        newDescriptionGlobal: "Library upload",
        namePlaceholder: "Knowledge base name",
        descriptionPlaceholder: "Optional description for the agent",
        chooseFilesLabel: "Choose files",
        chooseFolderLabel: "Choose folder",
        selectedFileCount: (count: number) => `${count} files selected`,
        selectedFileSize: (size: string) => `Total size ${size}`,
        rejectedFileCount: (count: number) => `${count} files rejected`,
        unsupportedFilesSelected: (count: number) =>
          `${count} unsupported files selected`,
        supportedFormatsHint: "Supported formats",
        uploadNextStepThread: "Thread next step",
        uploadNextStepLibrary: "Library next step",
      },
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
    HTMLElement.prototype.setPointerCapture = () => undefined;
  }
  if (!HTMLElement.prototype.releasePointerCapture) {
    HTMLElement.prototype.releasePointerCapture = () => undefined;
  }
});

describe("KnowledgeBaseUploadDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureThreadExists.mockResolvedValue(undefined);
  });

  it("creates thread knowledge from source files without a compile model", async () => {
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

    const { getByRole } = render(
      <QueryClientProvider client={queryClient}>
        <KnowledgeBaseUploadDialog
          threadId="thread-1"
          open
          onOpenChange={vi.fn()}
          ensureThreadExists={ensureThreadExists}
        />
      </QueryClientProvider>,
    );

    const fileInput =
      document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(fileInput).not.toBeNull();

    await user.upload(
      fileInput!,
      new File(["contract text"], "contract.pdf", {
        type: "application/pdf",
      }),
    );

    await user.click(getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(ensureThreadExists).toHaveBeenCalledTimes(1);
      expect(createThreadKnowledgeBase).toHaveBeenCalledWith(
        "thread-1",
        expect.objectContaining({
          name: "contract",
          description: "",
          files: [
            expect.objectContaining({
              name: "contract.pdf",
            }),
          ],
        }),
      );
    });

    const ensureCallOrder = ensureThreadExists.mock.invocationCallOrder[0];
    const createCallOrder = createThreadKnowledgeBase.mock.invocationCallOrder[0];
    expect(ensureCallOrder).toBeDefined();
    expect(createCallOrder).toBeDefined();
    if (ensureCallOrder == null || createCallOrder == null) {
      throw new Error("Expected both ensure and create calls to be recorded.");
    }
    expect(ensureCallOrder).toBeLessThan(createCallOrder);
  });

  it("creates library knowledge from source files without a compile model", async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    createKnowledgeBase.mockResolvedValue({
      knowledge_base_id: "kb-library",
      thread_id: "",
      status: "queued",
    });

    const { getByRole } = render(
      <QueryClientProvider client={queryClient}>
        <KnowledgeBaseUploadDialog open onOpenChange={vi.fn()} />
      </QueryClientProvider>,
    );

    const fileInput =
      document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(fileInput).not.toBeNull();

    await user.upload(
      fileInput!,
      new File(["contract text"], "contract.md", {
        type: "text/markdown",
      }),
    );

    await user.click(getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(createKnowledgeBase).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "contract",
          description: "",
          files: [
            expect.objectContaining({
              name: "contract.md",
            }),
          ],
        }),
      );
    });
  });
});
