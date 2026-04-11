import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { PublicAPIPlaygroundPanel } from "./public-api-playground-dialog";

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
});
