import type { Message } from "@langchain/langgraph-sdk";

type CenteredComposerArgs = {
  isNewThread: boolean;
  isPendingRun: boolean;
  isThreadLoading: boolean;
  messages: Message[];
};

type PendingRunRouteArgs = {
  routeHasPendingRun: boolean;
  hasLocalActiveRun: boolean;
};

type ThreadStreamConnectionArgs = {
  isMock: boolean;
  isNewThread: boolean;
  isPendingRun: boolean;
  hasThreadRuntime: boolean;
  threadUnavailable: boolean;
};

export function shouldHonorPendingRunParam({
  routeHasPendingRun,
  hasLocalActiveRun,
}: PendingRunRouteArgs) {
  // `pending_run=1` is a local recovery hint created by the tab that submitted
  // the run. Without local ownership, honoring it suppresses normal history and
  // runtime checks for shared, refreshed, or stale URLs.
  return routeHasPendingRun && hasLocalActiveRun;
}

export function shouldConnectThreadStream({
  isMock,
  isNewThread,
  isPendingRun,
  hasThreadRuntime,
  threadUnavailable,
}: ThreadStreamConnectionArgs) {
  if (threadUnavailable) {
    return false;
  }

  if (isMock || isNewThread || isPendingRun) {
    return true;
  }

  // Existing real-thread routes must prove their runtime binding first. This
  // prevents stale shared URLs from creating or hydrating LangGraph threads
  // before the product thread binding has been checked.
  return hasThreadRuntime;
}

export function shouldShowCenteredComposer({
  isNewThread,
  isPendingRun,
  isThreadLoading,
  messages,
}: CenteredComposerArgs) {
  if (!isNewThread) {
    return false;
  }

  if (isPendingRun || isThreadLoading) {
    return false;
  }

  return !messages.some(
    (message) => message.type === "human" || message.type === "ai",
  );
}
