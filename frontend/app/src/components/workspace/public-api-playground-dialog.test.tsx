import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { PublicAPIPlaygroundPanel } from "./public-api-playground-dialog";

const {
  createPublicAPITurnMock,
  streamPublicAPITurnMock,
} = vi.hoisted(() => ({
  createPublicAPITurnMock: vi.fn(),
  streamPublicAPITurnMock: vi.fn(),
}));

vi.mock("@/core/public-api/api", () => ({
  createPublicAPITurn: createPublicAPITurnMock,
  downloadPublicAPIArtifact: vi.fn(),
  getPublicAPITurn: vi.fn(),
  resolvePublicAPIBaseURL: (explicitBaseURL?: string | null) =>
    explicitBaseURL ?? "http://127.0.0.1:8083/v1",
  streamPublicAPITurn: streamPublicAPITurnMock,
  uploadPublicAPIFile: vi.fn(),
}));

vi.mock("@/core/i18n/hooks", () => ({
  useI18n: () => ({
    locale: "en-US",
  }),
}));

describe("PublicAPIPlaygroundPanel", () => {
  it("exposes labelled public playground fields for browser-driven testing", async () => {
    const user = userEvent.setup();

    render(
      <PublicAPIPlaygroundPanel
        agentName="reviewer"
        defaultBaseURL="http://127.0.0.1:8083/v1"
        accessMode="public"
        headerMode="hidden"
      />,
    );

    const baseURL = screen.getByLabelText("Base URL");
    const userKey = screen.getByLabelText("User Key");
    const prompt = screen.getByLabelText("Prompt");

    expect(baseURL).toHaveValue("http://127.0.0.1:8083/v1");
    expect(screen.queryByLabelText("Previous turn ID")).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Max output tokens"),
    ).not.toBeInTheDocument();

    await user.type(userKey, "df_test_key");
    await user.type(prompt, "Return ok.");

    expect(userKey).toHaveValue("df_test_key");
    expect(prompt).toHaveValue("Return ok.");

    await user.click(
      screen.getByRole("button", { name: /Advanced controls/i }),
    );

    expect(screen.getByLabelText("Previous turn ID")).toHaveValue("");
    expect(screen.getByLabelText("Max output tokens")).toHaveValue("");
  });

  it("links workspace users back to the dedicated API keys page instead of minting keys inline", () => {
    render(
      <MemoryRouter>
        <PublicAPIPlaygroundPanel
          agentName="reviewer"
          defaultBaseURL="http://127.0.0.1:8083/v1"
          apiKeysURL="/workspace/keys"
          headerMode="hidden"
        />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("link", { name: "Manage API keys" }),
    ).toHaveAttribute("href", "/workspace/keys");
    expect(
      screen.getByText(
        "Paste a key from the dedicated API keys page that is bound to this published agent.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Create scoped key/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Recent scoped keys")).not.toBeInTheDocument();
  });

  it("renders blocking turns waiting for input instead of completed", async () => {
    const user = userEvent.setup();
    createPublicAPITurnMock.mockResolvedValueOnce({
      id: "turn_waiting",
      object: "turn",
      created_at: 1,
      status: "requires_input",
      agent: "reviewer",
      thread_id: "thread-1",
      output_text: "",
      reasoning_text: "",
      events: [
        {
          sequence: 1,
          created_at: 1,
          type: "turn.started",
          turn_id: "turn_waiting",
        },
        {
          sequence: 2,
          created_at: 2,
          type: "turn.requires_input",
          turn_id: "turn_waiting",
          text: "question-1",
        },
      ],
      artifacts: [],
      usage: {
        input_tokens: 1,
        output_tokens: 0,
        total_tokens: 1,
      },
    });

    render(
      <PublicAPIPlaygroundPanel
        agentName="reviewer"
        defaultBaseURL="http://127.0.0.1:8083/v1"
        accessMode="public"
        headerMode="hidden"
      />,
    );

    await user.type(screen.getByLabelText("User Key"), "df_test_key");
    await user.type(
      screen.getByLabelText("Prompt"),
      "Use the question tool and wait.",
    );
    await user.click(screen.getByRole("switch", { name: "Use SSE stream" }));
    await user.click(screen.getByRole("button", { name: "Run published agent" }));

    expect(createPublicAPITurnMock).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByText("Turn is waiting for user input: turn_waiting"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Turn completed: turn_waiting")).not.toBeInTheDocument();
  });
});
