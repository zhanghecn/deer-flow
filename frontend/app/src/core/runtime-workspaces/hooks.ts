import { useMutation } from "@tanstack/react-query";

import { openRuntimeWorkspace } from "./api";

export function useOpenRuntimeWorkspace() {
  return useMutation({
    mutationFn: ({ threadId }: { threadId: string }) =>
      openRuntimeWorkspace(threadId),
  });
}
