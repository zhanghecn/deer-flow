import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { APIKeyManagementPage } from "./api-key-management-page";

type TokenRecord = {
  id: string;
  user_id: string;
  token?: string | null;
  name: string;
  scopes: string[];
  status: string;
  allowed_agents: string[];
  metadata?: Record<string, unknown>;
  last_used?: string | null;
  expires_at?: string | null;
  revoked_at?: string | null;
  created_at: string;
};

let tokenRecords: TokenRecord[] = [];

const listAPITokensMock = vi.fn<() => Promise<TokenRecord[]>>();
const createAPITokenMock =
  vi.fn<
    (request: {
      name: string;
      scopes?: string[];
      allowed_agents?: string[];
      metadata?: Record<string, unknown>;
    }) => Promise<TokenRecord & { token: string }>
  >();
const deleteAPITokenMock = vi.fn<(id: string) => Promise<void>>();
const toastSuccessMock = vi.fn<(message: string) => void>();
const toastErrorMock = vi.fn<(message: string) => void>();
const useAgentsMock = vi.fn<
  () => {
    agents: Array<{
      name: string;
      status: "prod";
      owner_user_id: string;
    }>;
    isLoading: boolean;
  }
>();
const useAuthMock = vi.fn<
  () => {
    user: {
      id: string;
      email: string;
      name: string;
      role?: string;
    };
  }
>();

vi.mock("@/core/auth/tokens", () => ({
  listAPITokens: () => listAPITokensMock(),
  createAPIToken: (request: {
    name: string;
    scopes?: string[];
    allowed_agents?: string[];
    metadata?: Record<string, unknown>;
  }) => createAPITokenMock(request),
  deleteAPIToken: (id: string) => deleteAPITokenMock(id),
}));

vi.mock("@/core/agents", () => ({
  useAgents: () => useAgentsMock(),
}));

vi.mock("@/core/auth/hooks", () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock("@/core/i18n/hooks", () => ({
  useI18n: () => ({
    locale: "en-US",
    t: {
      workspace: {
        apiKeys: "API keys",
      },
      pages: {
        appName: "OpenAgents",
      },
    },
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: (message: string) => toastSuccessMock(message),
    error: (message: string) => toastErrorMock(message),
  },
}));

vi.mock("@/components/workspace/workspace-container", () => ({
  WorkspaceContainer: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  WorkspaceHeader: () => <div>Header</div>,
  WorkspaceBody: ({
    children,
    className,
  }: {
    children: ReactNode;
    className?: string;
  }) => <main className={className}>{children}</main>,
}));

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
}

function renderPage() {
  const queryClient = createQueryClient();

  return render(
    <QueryClientProvider client={queryClient}>
      <APIKeyManagementPage />
    </QueryClientProvider>,
  );
}

describe("APIKeyManagementPage", () => {
  beforeEach(() => {
    window.sessionStorage.clear();

    tokenRecords = [
      {
        id: "token-active",
        user_id: "user-1",
        token: null,
        name: "active-reviewer-key",
        scopes: ["responses:create", "responses:read", "artifacts:read"],
        status: "active",
        allowed_agents: ["reviewer"],
        last_used: null,
        revoked_at: null,
        created_at: "2026-04-11T00:00:00Z",
      },
      {
        id: "token-revoked",
        user_id: "user-1",
        token: null,
        name: "revoked-reviewer-key",
        scopes: ["responses:create", "responses:read", "artifacts:read"],
        status: "revoked",
        allowed_agents: ["reviewer"],
        last_used: null,
        revoked_at: "2026-04-11T00:05:00Z",
        created_at: "2026-04-11T00:01:00Z",
      },
      {
        id: "token-expired",
        user_id: "user-1",
        token: "df_expired_token",
        name: "expired-reviewer-key",
        scopes: ["responses:create", "responses:read", "artifacts:read"],
        status: "active",
        allowed_agents: ["reviewer"],
        last_used: null,
        expires_at: "2000-01-01T00:00:00Z",
        revoked_at: null,
        created_at: "1999-12-31T23:59:00Z",
      },
    ];

    listAPITokensMock.mockReset();
    createAPITokenMock.mockReset();
    deleteAPITokenMock.mockReset();
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
    useAgentsMock.mockReset();
    useAuthMock.mockReset();

    listAPITokensMock.mockImplementation(async () =>
      tokenRecords.map((token) => ({ ...token })),
    );
    createAPITokenMock.mockImplementation(async (request) => {
      const createdRecord = {
        id: "token-new",
        user_id: "user-1",
        token: "df_secret_token",
        name: request.name,
        scopes: request.scopes ?? [],
        status: "active",
        allowed_agents: request.allowed_agents ?? [],
        metadata: request.metadata,
        last_used: null,
        revoked_at: null,
        created_at: "2026-04-11T00:10:00Z",
      };

      tokenRecords = [createdRecord, ...tokenRecords];
      return {
        ...createdRecord,
        token: "df_secret_token",
      };
    });
    deleteAPITokenMock.mockImplementation(async (id) => {
      tokenRecords = tokenRecords.map((token) =>
        token.id === id
          ? {
              ...token,
              status: "revoked",
              revoked_at: "2026-04-11T00:15:00Z",
            }
          : token,
      );
    });

    useAgentsMock.mockReturnValue({
      agents: [
        {
          name: "reviewer",
          status: "prod",
          owner_user_id: "user-1",
        },
      ],
      isLoading: false,
    });
    useAuthMock.mockReturnValue({
      user: {
        id: "user-1",
        email: "reviewer@example.com",
        name: "Reviewer",
        role: "user",
      },
    });
  });

  it("shows full keys inline when available, hides legacy prefixes, and lets the user click the key itself to copy it", async () => {
    const user = userEvent.setup();
    if (!navigator.clipboard) {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async () => undefined,
        },
      });
    }
    const clipboardWriteTextMock = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue();

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("active-reviewer-key")).toBeInTheDocument();
    });

    expect(screen.queryByText("revoked-reviewer-key")).not.toBeInTheDocument();
    expect(screen.queryByText("expired-reviewer-key")).not.toBeInTheDocument();
    expect(screen.queryByText("df_active...")).not.toBeInTheDocument();
    expect(screen.getAllByText("Rotate required").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "New key" }));
    await user.type(screen.getByLabelText("Key name"), "fresh-reviewer-key");
    await user.click(screen.getByRole("button", { name: "Create key" }));

    await waitFor(() => {
      expect(screen.getByText("Plaintext key ready")).toBeInTheDocument();
      expect(screen.getByText("fresh-reviewer-key")).toBeInTheDocument();
    });

    // The latest key is intentionally exposed in both the fresh-key card and
    // the inventory list so operators can copy from either surface.
    const latestTokenButtons = screen.getAllByRole("button", {
      name: /df_secret_token/i,
    });
    expect(latestTokenButtons).toHaveLength(2);
    const freshKeyButton = latestTokenButtons[0]!;
    const inventoryKeyButton = latestTokenButtons[1]!;

    await user.click(freshKeyButton);

    await waitFor(() => {
      expect(clipboardWriteTextMock).toHaveBeenCalledWith("df_secret_token");
    });

    expect(toastSuccessMock).toHaveBeenCalledWith("Key copied");
    clipboardWriteTextMock.mockClear();

    await user.click(inventoryKeyButton);

    await waitFor(() => {
      expect(clipboardWriteTextMock).toHaveBeenCalledWith("df_secret_token");
    });

    const createdKeyCard = screen.getByText("fresh-reviewer-key").closest("tr");
    expect(createdKeyCard).not.toBeNull();
    await user.click(
      within(createdKeyCard!).getByRole("button", {
        name: "Delete key",
      }),
    );

    const confirmRow = createdKeyCard?.nextElementSibling as HTMLElement | null;
    expect(confirmRow).not.toBeNull();
    expect(confirmRow).toHaveTextContent(
      "Deletion is permanent. Clients using this key will stop working immediately.",
    );
    await user.click(
      within(confirmRow!).getByRole("button", {
        name: "Delete key",
      }),
    );

    await waitFor(() => {
      expect(screen.queryByText("fresh-reviewer-key")).not.toBeInTheDocument();
    });
    expect(screen.queryByText("Plaintext key ready")).not.toBeInTheDocument();
  });

  it("lets admin create keys for published agents owned by other users", async () => {
    const user = userEvent.setup();

    useAgentsMock.mockReturnValue({
      agents: [
        {
          name: "foreign-reviewer",
          status: "prod",
          owner_user_id: "user-2",
        },
        {
          name: "owned-reviewer",
          status: "prod",
          owner_user_id: "admin-1",
        },
      ],
      isLoading: false,
    });
    useAuthMock.mockReturnValue({
      user: {
        id: "admin-1",
        email: "admin@example.com",
        name: "Admin",
        role: "admin",
      },
    });

    renderPage();

    const createButton = await screen.findByRole("button", { name: "Create key" });
    expect(createButton).toBeEnabled();

    await user.type(screen.getByLabelText("Key name"), "admin-foreign-key");
    await user.click(createButton);

    await waitFor(() => {
      expect(createAPITokenMock).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "admin-foreign-key",
          allowed_agents: ["foreign-reviewer"],
        }),
      );
    });
  });
});
