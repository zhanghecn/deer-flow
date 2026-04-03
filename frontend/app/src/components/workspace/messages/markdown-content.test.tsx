import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SidebarProvider } from "@/components/ui/sidebar";
import { I18nProvider } from "@/core/i18n/context";

import { ArtifactsProvider, useArtifacts } from "../artifacts";

import { MarkdownContent } from "./markdown-content";

vi.mock("@/components/ai-elements/message", () => {
  return {
    MessageResponse: ({
      components,
    }: {
      components?: {
        a?: (props: { children?: ReactNode; href?: string }) => ReactNode;
      };
    }) => {
      const Anchor = components?.a;
      if (!Anchor) {
        return null;
      }
      return (
        <Anchor href="kb://citation?artifact_path=/mnt/user-data/outputs/.knowledge/doc-1/PRML.pdf&locator_type=page&page=12">
          <span>citation:PRML.pdf p.12</span>
        </Anchor>
      );
    },
  };
});

function PreviewState() {
  const { previewTarget } = useArtifacts();

  return (
    <>
      <div data-testid="preview-filepath">{previewTarget?.filepath ?? "none"}</div>
      <div data-testid="preview-page">{previewTarget?.page ?? "none"}</div>
    </>
  );
}

function renderWithProviders(node: ReactNode) {
  return render(
    <I18nProvider initialLocale="en-US">
      <SidebarProvider>
        <ArtifactsProvider>{node}</ArtifactsProvider>
      </SidebarProvider>
    </I18nProvider>,
  );
}

describe("MarkdownContent knowledge citations", () => {
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
  });

  it("reveals source previews when citation children are wrapped nodes", () => {
    renderWithProviders(
      <>
        <PreviewState />
        <MarkdownContent
          content="ignored"
          isLoading={false}
          rehypePlugins={[]}
        />
      </>,
    );

    fireEvent.click(screen.getByRole("link", { name: "PRML.pdf p.12" }));

    expect(screen.getByTestId("preview-filepath").textContent).toBe(
      "/mnt/user-data/outputs/.knowledge/doc-1/PRML.pdf",
    );
    expect(screen.getByTestId("preview-page").textContent).toBe("12");
  });
});
