import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { PublicAPIPlaygroundPanel } from "./public-api-playground-dialog";

const {
  createPublicAPIResponseMock,
  streamPublicAPIResponseMock,
} = vi.hoisted(() => ({
  createPublicAPIResponseMock: vi.fn(),
  streamPublicAPIResponseMock: vi.fn(),
}));

vi.mock("@/core/public-api/api", () => ({
  createPublicAPIResponse: createPublicAPIResponseMock,
  downloadPublicAPIArtifact: vi.fn(),
  getPublicAPIResponse: vi.fn(),
  resolvePublicAPIBaseURL: (explicitBaseURL?: string | null) =>
    explicitBaseURL ?? "http://127.0.0.1:8083/v1",
  streamPublicAPIResponse: streamPublicAPIResponseMock,
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
    expect(
      screen.queryByLabelText("Previous response ID"),
    ).not.toBeInTheDocument();
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

    expect(screen.getByLabelText("Previous response ID")).toHaveValue("");
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

  it("renders incomplete blocking responses as waiting for input instead of completed", async () => {
    const user = userEvent.setup();
    createPublicAPIResponseMock.mockResolvedValueOnce({
      id: "resp_incomplete",
      object: "response",
      created_at: 1,
      status: "incomplete",
      model: "reviewer",
      output_text: "",
      output: [],
      openagents: {
        thread_id: "thread-1",
        run_events: [
          {
            event_index: 1,
            created_at: 1,
            type: "run_started",
            response_id: "resp_incomplete",
          },
          {
            event_index: 2,
            created_at: 2,
            type: "question_requested",
            question_id: "question-1",
          },
        ],
      },
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

    expect(createPublicAPIResponseMock).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByText(
        "Response is waiting for user input: resp_incomplete",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Response completed: resp_incomplete")).not.toBeInTheDocument();
  });
});
