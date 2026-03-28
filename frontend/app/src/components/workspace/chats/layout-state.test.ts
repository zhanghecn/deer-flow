import type { Message } from "@langchain/langgraph-sdk";
import { describe, expect, it } from "vitest";

import { shouldShowCenteredComposer } from "./layout-state";

function createMessage(type: Message["type"]): Message {
  return {
    id: `${type}-1`,
    type,
    content: "",
  } as Message;
}

describe("shouldShowCenteredComposer", () => {
  it("shows the centered composer only for an untouched new thread", () => {
    expect(
      shouldShowCenteredComposer({
        isNewThread: true,
        isPendingRun: false,
        isThreadLoading: false,
        messages: [],
      }),
    ).toBe(true);
  });

  it("hides the centered composer once a pending run starts", () => {
    expect(
      shouldShowCenteredComposer({
        isNewThread: true,
        isPendingRun: true,
        isThreadLoading: false,
        messages: [],
      }),
    ).toBe(false);
  });

  it("hides the centered composer once the first turn has visible messages", () => {
    expect(
      shouldShowCenteredComposer({
        isNewThread: true,
        isPendingRun: false,
        isThreadLoading: false,
        messages: [createMessage("human"), createMessage("ai")],
      }),
    ).toBe(false);
  });
});
