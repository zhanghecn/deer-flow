import { waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_LOCAL_SETTINGS } from "@/core/settings";
import { renderWithProviders } from "@/test/render";

import NewChatSender from "./new-chat-sender";

const useThreadStreamMock = vi.fn();

vi.mock("@/core/threads/hooks", () => ({
  useThreadStream: (...args: unknown[]) => useThreadStreamMock(...args),
}));

describe("NewChatSender", () => {
  it("navigates with the preallocated thread id once the sender is ready", async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    useThreadStreamMock.mockReturnValue([null, sendMessage, null, true]);

    const onStartedThread = vi.fn();
    const onError = vi.fn();

    renderWithProviders(
      <NewChatSender
        threadId="thread-123"
        message={{ text: "hello", files: [] }}
        extraContext={{ command_name: "create-skill" }}
        context={DEFAULT_LOCAL_SETTINGS.context}
        isMock={false}
        onStartedThread={onStartedThread}
        onError={onError}
      />,
    );

    await waitFor(() => {
      expect(onStartedThread).toHaveBeenCalledWith("thread-123");
    });
    await waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith(
        "thread-123",
        { text: "hello", files: [] },
        { command_name: "create-skill" },
      );
    });
    expect(onError).not.toHaveBeenCalled();
  });

  it("submits only once when StrictMode remounts the sender", async () => {
    const sendMessage = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          setTimeout(resolve, 0);
        }),
    );
    useThreadStreamMock.mockReturnValue([null, sendMessage, null, true]);

    renderWithProviders(
      <StrictMode>
        <NewChatSender
          threadId="thread-strict"
          message={{ text: "hello", files: [] }}
          context={DEFAULT_LOCAL_SETTINGS.context}
          isMock={false}
          onStartedThread={vi.fn()}
          onError={vi.fn()}
        />
      </StrictMode>,
    );

    await waitFor(() => {
      expect(sendMessage).toHaveBeenCalledTimes(1);
    });
  });
});
