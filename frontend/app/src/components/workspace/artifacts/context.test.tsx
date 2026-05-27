import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SidebarProvider, useSidebar } from "@/components/ui/sidebar";

import { ArtifactsProvider, useArtifacts } from "./context";

function RevealHarness() {
  const { artifacts, previewTarget, reveal, reset } = useArtifacts();

  return (
    <div>
      <button
        type="button"
        onClick={() =>
          reveal({
            filepath: "/mnt/user-data/outputs/demo.pdf",
            page: 7,
          })
        }
      >
        Reveal Page 7
      </button>
      <button
        type="button"
        onClick={() =>
          reveal({
            filepath: "/mnt/user-data/outputs/demo.pdf",
            page: 572,
          })
        }
      >
        Reveal Page 572
      </button>
      <button type="button" onClick={() => reset()}>
        Reset Preview
      </button>
      <div data-testid="artifact-count">{artifacts.length}</div>
      <div data-testid="preview-page">{previewTarget?.page ?? "none"}</div>
      <div data-testid="preview-sequence">
        {previewTarget?.revealSequence ?? "none"}
      </div>
    </div>
  );
}

function SidebarStateHarness() {
  const { isMobile, open, openMobile, setOpenMobile } = useSidebar();
  const { reveal, select } = useArtifacts();

  return (
    <div>
      <button
        type="button"
        onClick={() => select("/mnt/user-data/outputs/demo.pdf")}
      >
        Select Artifact
      </button>
      <button
        type="button"
        onClick={() =>
          reveal({
            filepath: "/mnt/user-data/outputs/demo.pdf",
            page: 7,
          })
        }
      >
        Reveal Artifact
      </button>
      <button type="button" onClick={() => setOpenMobile(true)}>
        Open Mobile Sidebar
      </button>
      <div data-testid="sidebar-open">{open ? "open" : "closed"}</div>
      <div data-testid="mobile-sidebar-open">
        {openMobile ? "open" : "closed"}
      </div>
      <div data-testid="viewport-kind">{isMobile ? "mobile" : "desktop"}</div>
    </div>
  );
}

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
}

describe("ArtifactsProvider", () => {
  beforeEach(() => {
    setViewportWidth(1024);
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

  it("increments reveal sequence on every citation reveal", () => {
    render(
      <SidebarProvider>
        <ArtifactsProvider>
          <RevealHarness />
        </ArtifactsProvider>
      </SidebarProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Reveal Page 7" }));
    expect(screen.getByTestId("preview-page").textContent).toBe("7");
    expect(screen.getByTestId("preview-sequence").textContent).toBe("1");

    fireEvent.click(screen.getByRole("button", { name: "Reveal Page 572" }));
    expect(screen.getByTestId("preview-page").textContent).toBe("572");
    expect(screen.getByTestId("preview-sequence").textContent).toBe("2");
  });

  it("clears the selected preview state on reset", () => {
    render(
      <SidebarProvider>
        <ArtifactsProvider>
          <RevealHarness />
        </ArtifactsProvider>
      </SidebarProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Reveal Page 7" }));
    expect(screen.getByTestId("artifact-count").textContent).toBe("1");
    expect(screen.getByTestId("preview-page").textContent).toBe("7");

    fireEvent.click(screen.getByRole("button", { name: "Reset Preview" }));
    expect(screen.getByTestId("artifact-count").textContent).toBe("0");
    expect(screen.getByTestId("preview-page").textContent).toBe("none");
  });

  it("keeps the desktop sidebar open when selecting or revealing artifacts", () => {
    render(
      <SidebarProvider>
        <ArtifactsProvider>
          <SidebarStateHarness />
        </ArtifactsProvider>
      </SidebarProvider>,
    );

    expect(screen.getByTestId("sidebar-open").textContent).toBe("open");

    fireEvent.click(screen.getByRole("button", { name: "Select Artifact" }));
    expect(screen.getByTestId("sidebar-open").textContent).toBe("open");

    fireEvent.click(screen.getByRole("button", { name: "Reveal Artifact" }));
    expect(screen.getByTestId("sidebar-open").textContent).toBe("open");
  });

  it("dismisses the mobile sidebar drawer when revealing an artifact", async () => {
    setViewportWidth(375);
    render(
      <SidebarProvider>
        <ArtifactsProvider>
          <SidebarStateHarness />
        </ArtifactsProvider>
      </SidebarProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("viewport-kind").textContent).toBe("mobile"),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Open Mobile Sidebar" }),
    );
    expect(screen.getByTestId("mobile-sidebar-open").textContent).toBe("open");

    fireEvent.click(screen.getByRole("button", { name: "Reveal Artifact" }));
    expect(screen.getByTestId("mobile-sidebar-open").textContent).toBe(
      "closed",
    );
  });
});
