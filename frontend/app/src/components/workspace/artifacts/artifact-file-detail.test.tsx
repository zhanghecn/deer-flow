import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ThreadContext } from "@/components/workspace/messages/context";

import { ArtifactFilePreview } from "./artifact-file-detail";

const mockUseArtifactObjectUrl = vi.fn();

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

describe("ArtifactFilePreview", () => {
  beforeEach(() => {
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
    render(
      <ThreadContext.Provider
        value={{ thread: { values: {} } as never, isMock: false }}
      >
        <ArtifactFilePreview
          filepath="outputs/demo/README.md"
          threadId="thread-1"
          content="![Cover](./assets/cover.png)"
          isLoading={false}
          error={null}
          language="markdown"
        />
      </ThreadContext.Provider>,
    );

    await waitFor(() => {
      expect(screen.getByAltText("Cover").getAttribute("src")).toBe(
        "blob:cover-image",
      );
    });
  });
});
