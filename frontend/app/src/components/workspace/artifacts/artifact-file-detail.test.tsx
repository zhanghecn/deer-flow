import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SidebarProvider } from "@/components/ui/sidebar";
import { ThreadContext } from "@/components/workspace/messages/context";
import { I18nProvider } from "@/core/i18n/context";
import { WorkspaceSurfaceProvider } from "@/core/workspace-surface/context";

import {
  ArtifactFileDetail,
  ArtifactFilePreview,
  scrollArtifactMarkdownPreview,
} from "./artifact-file-detail";
import { ArtifactsProvider, useArtifacts } from "./context";

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
        a?: (props: { children?: ReactNode; href?: string }) => ReactNode;
      };
    }) => {
      const imageMatch = /!\[([^\]]*)\]\(([^)]+)\)/.exec(children);
      if (imageMatch && components?.img) {
        const [, alt, src] = imageMatch;
        return components.img({ alt, src });
      }

      const linkMatch = /\[([^\]]+)\]\(([^)]+)\)/.exec(children);
      if (linkMatch && components?.a) {
        const [, label, href] = linkMatch;
        return components.a({
          href,
          children: <span>{label}</span>,
        });
      }

      return <>{children}</>;
    },
  };
});

vi.mock("@/core/artifacts/hooks", async () => {
  const actual = await vi.importActual("@/core/artifacts/hooks");

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
          <WorkspaceSurfaceProvider>
            <ArtifactsProvider>
              <ThreadContext.Provider
                value={{ thread: { values: {} } as never, isMock: false }}
              >
                {node}
              </ThreadContext.Provider>
            </ArtifactsProvider>
          </WorkspaceSurfaceProvider>
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

function MarkdownCitationRevealHarness() {
  const { previewTarget } = useArtifacts();

  return (
    <>
      <div data-testid="preview-filepath">
        {previewTarget?.filepath ?? "none"}
      </div>
      <div data-testid="preview-page">{previewTarget?.page ?? "none"}</div>
      <ArtifactFilePreview
        filepath="/mnt/user-data/outputs/.knowledge/doc-1/canonical.md"
        threadId="thread-1"
        content="[citation:PRML.pdf p.12](kb://citation?artifact_path=/mnt/user-data/outputs/.knowledge/doc-1/PRML.pdf&locator_type=page&page=12)"
        isLoading={false}
        error={null}
        language="markdown"
      />
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
        if (
          enabled &&
          filepath ===
            "/mnt/user-data/outputs/.knowledge/doc-1/assets/page-0012.png"
        ) {
          return {
            objectUrl: "blob:kb-page-image",
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
    renderWithProviders(<PdfRevealHarness />);

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

  it("reveals knowledge citations from markdown previews when the link label is wrapped", () => {
    renderWithProviders(<MarkdownCitationRevealHarness />);

    fireEvent.click(screen.getByRole("link", { name: "PRML.pdf p.12" }));

    expect(screen.getByTestId("preview-filepath").textContent).toBe(
      "/mnt/user-data/outputs/.knowledge/doc-1/PRML.pdf",
    );
    expect(screen.getByTestId("preview-page").textContent).toBe("12");
  });

  it("reveals markdown previews by heading before falling back to line scrolling", () => {
    const container = document.createElement("div");
    const target = document.createElement("h2");
    target.setAttribute("data-heading-slug", "focus-target");
    const scrollIntoView = vi.fn();
    target.scrollIntoView = scrollIntoView;
    container.appendChild(target);
    const scrollTo = vi.fn();
    container.scrollTo = scrollTo;

    const didReveal = scrollArtifactMarkdownPreview(container, {
      activeHeading: "focus-target",
      activeLine: 42,
      totalLines: 100,
    });

    expect(didReveal).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledWith({
      block: "center",
      behavior: "auto",
    });
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("falls back to line-based markdown reveal when the heading is unavailable", () => {
    const container = document.createElement("div");
    Object.defineProperty(container, "scrollHeight", {
      configurable: true,
      value: 1200,
    });
    Object.defineProperty(container, "clientHeight", {
      configurable: true,
      value: 200,
    });
    const scrollTo = vi.fn();
    container.scrollTo = scrollTo;

    const didReveal = scrollArtifactMarkdownPreview(container, {
      activeHeading: "missing-heading",
      activeLine: 51,
      totalLines: 101,
    });

    expect(didReveal).toBe(true);
    expect(scrollTo).toHaveBeenCalledWith({
      top: 500,
      behavior: "auto",
    });
  });

  it("falls back to line-based markdown reveal when duplicate headings exist", () => {
    const container = document.createElement("div");
    const first = document.createElement("h2");
    const second = document.createElement("h2");
    first.setAttribute("data-heading-slug", "duplicate-heading");
    second.setAttribute("data-heading-slug", "duplicate-heading");
    const firstScrollIntoView = vi.fn();
    const secondScrollIntoView = vi.fn();
    first.scrollIntoView = firstScrollIntoView;
    second.scrollIntoView = secondScrollIntoView;
    container.appendChild(first);
    container.appendChild(second);
    Object.defineProperty(container, "scrollHeight", {
      configurable: true,
      value: 1000,
    });
    Object.defineProperty(container, "clientHeight", {
      configurable: true,
      value: 200,
    });
    const scrollTo = vi.fn();
    container.scrollTo = scrollTo;

    const didReveal = scrollArtifactMarkdownPreview(container, {
      activeHeading: "duplicate-heading",
      activeLine: 76,
      totalLines: 101,
    });

    expect(didReveal).toBe(true);
    expect(firstScrollIntoView).not.toHaveBeenCalled();
    expect(secondScrollIntoView).not.toHaveBeenCalled();
    expect(scrollTo).toHaveBeenCalledWith({
      top: 600,
      behavior: "auto",
    });
  });

  it("renders kb asset markdown images from knowledge storage paths", async () => {
    renderWithProviders(
      <ArtifactFilePreview
        filepath="/mnt/user-data/outputs/.knowledge/doc-1/canonical.md"
        threadId="thread-1"
        content="![Figure 12](kb://asset?artifact_path=/mnt/user-data/outputs/.knowledge/doc-1/PRML.pdf&asset_path=/mnt/user-data/outputs/.knowledge/doc-1/assets/page-0012.png&locator_type=page&page=12)"
        isLoading={false}
        error={null}
        language="markdown"
      />,
    );

    await waitFor(() => {
      expect(screen.getByAltText("Figure 12").getAttribute("src")).toBe(
        "blob:kb-page-image",
      );
    });
  });
});
