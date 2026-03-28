import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SidebarProvider } from "@/components/ui/sidebar";

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

describe("ArtifactsProvider", () => {
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
});
