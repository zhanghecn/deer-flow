import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { I18nProvider } from "@/core/i18n/context";

import AgentSettingsPage from "./page";

describe("AgentSettingsPage", () => {
  function renderWithProviders(children: ReactNode) {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    return render(
      <QueryClientProvider client={queryClient}>
        <I18nProvider initialLocale="en-US">{children}</I18nProvider>
      </QueryClientProvider>,
    );
  }

  it("renders the selected agent settings route", () => {
    renderWithProviders(
      <MemoryRouter
        initialEntries={[
          "/workspace/agents/reviewer/settings?agent_status=prod&execution_backend=remote&remote_session_id=remote-1",
        ]}
      >
        <Routes>
          <Route
            path="/workspace/agents/:agent_name/settings"
            element={<AgentSettingsPage />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "reviewer" })).toBeInTheDocument();
    expect(screen.getByText("prod")).toBeInTheDocument();
    expect(screen.getByText("Remote")).toBeInTheDocument();
  });

  it("returns to the agent gallery when the back control is clicked", async () => {
    const user = userEvent.setup();

    renderWithProviders(
      <MemoryRouter
        initialEntries={["/workspace/agents/reviewer/settings?agent_status=dev"]}
      >
        <Routes>
          <Route path="/workspace/agents" element={<div>agent gallery route</div>} />
          <Route
            path="/workspace/agents/:agent_name/settings"
            element={<AgentSettingsPage />}
          />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: /back to gallery/i }));

    expect(screen.getByText("agent gallery route")).toBeInTheDocument();
  });
});
