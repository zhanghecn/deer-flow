import type { Message } from "@langchain/langgraph-sdk";
import { describe, expect, it } from "vitest";

import {
  shouldConnectThreadStream,
  shouldHonorPendingRunParam,
  shouldShowCenteredComposer,
} from "./layout-state";

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

describe("shouldHonorPendingRunParam", () => {
  it("only honors pending_run when this tab owns a live run", () => {
    expect(
      shouldHonorPendingRunParam({
        routeHasPendingRun: true,
        hasLocalActiveRun: true,
      }),
    ).toBe(true);

    expect(
      shouldHonorPendingRunParam({
        routeHasPendingRun: true,
        hasLocalActiveRun: false,
      }),
    ).toBe(false);
  });

  it("keeps normal thread loading when the URL has no pending flag", () => {
    expect(
      shouldHonorPendingRunParam({
        routeHasPendingRun: false,
        hasLocalActiveRun: true,
      }),
    ).toBe(false);
  });
});

describe("shouldConnectThreadStream", () => {
  it("waits for runtime binding before hydrating an existing real thread", () => {
    expect(
      shouldConnectThreadStream({
        isMock: false,
        isNewThread: false,
        isPendingRun: false,
        hasThreadRuntime: false,
        threadUnavailable: false,
      }),
    ).toBe(false);

    expect(
      shouldConnectThreadStream({
        isMock: false,
        isNewThread: false,
        isPendingRun: false,
        hasThreadRuntime: true,
        threadUnavailable: false,
      }),
    ).toBe(true);
  });

  it("keeps local-only thread flows connected without runtime binding", () => {
    expect(
      shouldConnectThreadStream({
        isMock: false,
        isNewThread: true,
        isPendingRun: false,
        hasThreadRuntime: false,
        threadUnavailable: false,
      }),
    ).toBe(true);

    expect(
      shouldConnectThreadStream({
        isMock: true,
        isNewThread: false,
        isPendingRun: false,
        hasThreadRuntime: false,
        threadUnavailable: false,
      }),
    ).toBe(true);

    expect(
      shouldConnectThreadStream({
        isMock: false,
        isNewThread: false,
        isPendingRun: true,
        hasThreadRuntime: false,
        threadUnavailable: false,
      }),
    ).toBe(true);
  });

  it("does not connect stream/history for unavailable thread links", () => {
    expect(
      shouldConnectThreadStream({
        isMock: false,
        isNewThread: true,
        isPendingRun: true,
        hasThreadRuntime: true,
        threadUnavailable: true,
      }),
    ).toBe(false);
  });
});
