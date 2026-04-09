import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
        showHero={false}
      />,
    );

    const baseURL = screen.getByLabelText("Base URL");
    const userKey = screen.getByLabelText("User Key");
    const previousResponse = screen.getByLabelText("Previous response ID");
    const prompt = screen.getByLabelText("Prompt");
    const maxOutputTokens = screen.getByLabelText("Max output tokens");

    expect(baseURL).toHaveValue("http://127.0.0.1:8083/v1");
    expect(previousResponse).toHaveValue("");
    expect(maxOutputTokens).toHaveValue("");

    await user.type(userKey, "df_test_key");
    await user.type(prompt, "Return ok.");

    expect(userKey).toHaveValue("df_test_key");
    expect(prompt).toHaveValue("Return ok.");
  });
});
