import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MessageGroup, shouldShowTrailingReasoning } from "./message-group";

vi.mock("@/core/i18n/hooks", () => ({
  useI18n: () => ({
    t: {
      common: { thinking: "Thinking" },
      toolCalls: {
        lessSteps: "Less steps",
        moreSteps: (count: number) => `${count} more steps`,
        searchForRelatedInfo: "Search for related info",
        searchOnWebFor: (query: string) => `Search on web for ${query}`,
        searchForRelatedImages: "Search for related images",
        searchForRelatedImagesFor: (query: string) =>
          `Search for related images for ${query}`,
        viewWebPage: "View web page",
        listFolder: "List folder",
        readFile: "Read file",
        writeFile: "Write file",
        executeCommand: "Execute command",
        useTool: (name: string) => name,
        presentFiles: "Present files",
        writeTodos: "Write todos",
      },
    },
  }),
}));

vi.mock("../artifacts", () => ({
  useArtifacts: () => ({
    setOpen: vi.fn(),
    autoOpen: false,
    autoSelect: false,
    selectedArtifact: null,
    select: vi.fn(),
  }),
}));

vi.mock("@/components/ai-elements/code-block", () => ({
  CodeBlock: ({
    code,
    renderMode,
    viewportClassName,
  }: {
    code: string;
    renderMode?: string;
    viewportClassName?: string;
  }) => (
    <pre data-render-mode={renderMode} data-viewport-class={viewportClassName}>
      {code}
    </pre>
  ),
}));

describe("shouldShowTrailingReasoning", () => {
  it("keeps trailing reasoning visible while the turn is still streaming", () => {
    expect(shouldShowTrailingReasoning("assistant", true)).toBe(true);
  });

  it("hides trailing reasoning when a completed processing group is followed by a visible assistant reply", () => {
    expect(shouldShowTrailingReasoning("assistant", false)).toBe(false);
  });

  it("keeps trailing reasoning when there is no follow-up assistant group", () => {
    expect(shouldShowTrailingReasoning(undefined, false)).toBe(true);
  });
});

describe("MessageGroup tool display", () => {
  it("shows the full runtime path for read_file tool calls", () => {
    render(
      <MessageGroup
        messages={[
          {
            id: "ai-1",
            type: "ai",
            content: "",
            tool_calls: [
              {
                id: "tool-1",
                name: "read_file",
                args: {
                  file_path:
                    "/mnt/user-data/agents/dev/lead_agent/skills/surprise-me/SKILL.md",
                },
              },
            ],
          },
          {
            id: "tool-msg-1",
            type: "tool",
            tool_call_id: "tool-1",
            content: "content",
          },
        ]}
      />,
    );

    expect(
      screen.getByText(
        "/mnt/user-data/agents/dev/lead_agent/skills/surprise-me/SKILL.md",
      ),
    ).toBeInTheDocument();
  });

  it("shows execute tool output inside the chain-of-thought step", () => {
    render(
      <MessageGroup
        messages={[
          {
            id: "ai-1",
            type: "ai",
            content: "",
            tool_calls: [
              {
                id: "tool-1",
                name: "execute",
                args: {
                  command: "whoami",
                },
              },
            ],
          },
          {
            id: "tool-msg-1",
            type: "tool",
            tool_call_id: "tool-1",
            content: "gem\n[Command succeeded with exit code 0]",
          },
        ]}
      />,
    );

    expect(screen.getByText("whoami")).toBeInTheDocument();
    expect(
      screen.getByText((_, element) =>
        element?.textContent === "gem\n[Command succeeded with exit code 0]",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("whoami")).toHaveAttribute(
      "data-render-mode",
      "highlight",
    );
    expect(screen.getByText("whoami")).not.toHaveAttribute(
      "data-viewport-class",
    );
  });

  it("allows older tool steps to stay collapsed until expanded", () => {
    render(
      <MessageGroup
        messages={[
          {
            id: "ai-1",
            type: "ai",
            content: "",
            tool_calls: [
              {
                id: "tool-1",
                name: "read_file",
                args: {
                  file_path: "/mnt/user-data/project/README.md",
                },
              },
              {
                id: "tool-2",
                name: "execute",
                args: {
                  command: "pwd",
                },
              },
            ],
          },
          {
            id: "tool-msg-1",
            type: "tool",
            tool_call_id: "tool-1",
            content: "file contents",
          },
          {
            id: "tool-msg-2",
            type: "tool",
            tool_call_id: "tool-2",
            content: "/mnt/user-data/project",
          },
        ]}
      />,
    );

    expect(
      screen.queryByText("/mnt/user-data/project/README.md"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("pwd")).toBeInTheDocument();
    fireEvent.click(screen.getByText("1 more steps"));
    expect(
      screen.getByText("/mnt/user-data/project/README.md"),
    ).toBeInTheDocument();
    expect(screen.getByText("Less steps")).toBeInTheDocument();
  });

  it("lets large command output grow naturally instead of pinning a fixed viewport", () => {
    const largeOutput = Array.from({ length: 40 }, (_, index) => `line ${index}`)
      .join("\n");

    render(
      <MessageGroup
        messages={[
          {
            id: "ai-1",
            type: "ai",
            content: "",
            tool_calls: [
              {
                id: "tool-1",
                name: "bash",
                args: {
                  command: "cat huge.log",
                },
              },
            ],
          },
          {
            id: "tool-msg-1",
            type: "tool",
            tool_call_id: "tool-1",
            content: largeOutput,
          },
        ]}
      />,
    );

    expect(
      screen.getByText((_, element) => element?.textContent === largeOutput),
    ).not.toHaveAttribute("data-viewport-class");
  });

  it("renders image_search results with source links and thumbnails", () => {
    render(
      <MessageGroup
        messages={[
          {
            id: "ai-1",
            type: "ai",
            content: "",
            tool_calls: [
              {
                id: "tool-1",
                name: "image_search",
                args: {
                  query: "retro cat",
                },
              },
            ],
          },
          {
            id: "tool-msg-1",
            type: "tool",
            tool_call_id: "tool-1",
            content: JSON.stringify({
              results: [
                {
                  title: "Retro Cat Poster",
                  source_url: "https://example.com/retro-cat",
                  thumbnail_url: "https://cdn.example.com/retro-cat-thumb.jpg",
                  image_url: "https://cdn.example.com/retro-cat-full.jpg",
                },
              ],
            }),
          },
        ]}
      />,
    );

    expect(
      screen.getByRole("link", { name: "Retro Cat Poster" }),
    ).toHaveAttribute("href", "https://example.com/retro-cat");
    expect(screen.getByRole("img", { name: "Retro Cat Poster" })).toHaveAttribute(
      "src",
      "https://cdn.example.com/retro-cat-thumb.jpg",
    );
  });
});
