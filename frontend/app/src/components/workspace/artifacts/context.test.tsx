import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SidebarProvider } from "@/components/ui/sidebar";

import { ArtifactsProvider, useArtifacts } from "./context";

function RevealHarness() {
  const { previewTarget, reveal } = useArtifacts();

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
});
