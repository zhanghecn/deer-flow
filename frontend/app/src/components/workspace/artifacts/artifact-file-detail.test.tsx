import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SidebarProvider } from "@/components/ui/sidebar";
import { I18nProvider } from "@/core/i18n/context";
import { ThreadContext } from "@/components/workspace/messages/context";

import { ArtifactsProvider, useArtifacts } from "./context";
import { ArtifactFileDetail, ArtifactFilePreview } from "./artifact-file-detail";

const mockUseArtifactObjectUrl = vi.fn();
const pdfFilepath = "/mnt/user-data/outputs/demo.pdf";

vi.mock("streamdown", () => {
  return {
    Streamdown: ({
      children,
      components,
    }: {
      children: string;
      components?: {
        img?: (props: { alt?: string; src?: string }) => ReactNode;
      };
    }) => {
      const imageMatch = /!\[([^\]]*)\]\(([^)]+)\)/.exec(children);
      if (imageMatch && components?.img) {
        const [, alt, src] = imageMatch;
        return components.img({ alt, src });
      }
      return <>{children}</>;
    },
  };
});

vi.mock("@/core/artifacts/hooks", async () => {
  const actual = await vi.importActual<typeof import("@/core/artifacts/hooks")>(
    "@/core/artifacts/hooks",
  );

  return {
    ...actual,
    useArtifactObjectUrl: (args: unknown) => mockUseArtifactObjectUrl(args),
  };
});

function renderWithProviders(node: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider initialLocale="en-US">
        <SidebarProvider>
          <ThreadContext.Provider
            value={{ thread: { values: {} } as never, isMock: false }}
          >
            {node}
          </ThreadContext.Provider>
        </SidebarProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

function PdfRevealHarness() {
  const { reveal } = useArtifacts();

  return (
    <>
      <button
        type="button"
        onClick={() => reveal({ filepath: pdfFilepath, page: 7 })}
      >
        Reveal PDF Page 7
      </button>
      <button
        type="button"
        onClick={() => reveal({ filepath: pdfFilepath, page: 572 })}
      >
        Reveal PDF Page 572
      </button>
      <ArtifactFileDetail filepath={pdfFilepath} threadId="thread-1" />
    </>
  );
}

describe("ArtifactFilePreview", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation(() => ({
        matches: false,
        media: "",
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );
    mockUseArtifactObjectUrl.mockReset();
    mockUseArtifactObjectUrl.mockImplementation(
      ({ filepath, enabled }: { filepath: string; enabled?: boolean }) => {
        if (
          enabled &&
          filepath === "/mnt/user-data/outputs/demo/assets/cover.png"
        ) {
          return {
            objectUrl: "blob:cover-image",
            blobType: "image/png",
            isLoading: false,
            error: null,
          };
        }
        if (enabled && filepath === pdfFilepath) {
          return {
            objectUrl: "blob:demo-pdf",
            blobType: "application/pdf",
            isLoading: false,
            error: null,
          };
        }

        return {
          objectUrl: null,
          blobType: null,
          isLoading: false,
          error: null,
        };
      },
    );
  });

  it("renders markdown images from internal artifact paths with object urls", async () => {
    renderWithProviders(
      <>
        <ArtifactFilePreview
          filepath="outputs/demo/README.md"
          threadId="thread-1"
          content="![Cover](./assets/cover.png)"
          isLoading={false}
          error={null}
          language="markdown"
        />
      </>,
    );

    await waitFor(() => {
      expect(screen.getByAltText("Cover").getAttribute("src")).toBe(
        "blob:cover-image",
      );
    });
  });

  it("updates the inline pdf preview when citations reveal a new page", async () => {
    renderWithProviders(
      <ArtifactsProvider>
        <PdfRevealHarness />
      </ArtifactsProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Reveal PDF Page 7" }));
    await waitFor(() => {
      expect(screen.getByTitle("demo.pdf").getAttribute("src")).toBe(
        "blob:demo-pdf#page=7",
      );
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Reveal PDF Page 572" }),
    );
    await waitFor(() => {
      expect(screen.getByTitle("demo.pdf").getAttribute("src")).toBe(
        "blob:demo-pdf#page=572",
      );
    });
  });
});
