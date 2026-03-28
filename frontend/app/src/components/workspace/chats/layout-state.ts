import type { Message } from "@langchain/langgraph-sdk";

type CenteredComposerArgs = {
  isNewThread: boolean;
  isPendingRun: boolean;
  isThreadLoading: boolean;
  messages: Message[];
};

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
