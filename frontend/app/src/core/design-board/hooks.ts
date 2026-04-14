import { useMutation } from "@tanstack/react-query";

import { openDesignBoard } from "./api";

export function useOpenDesignBoard() {
  return useMutation({
    mutationFn: ({
      threadId,
      targetPath,
    }: {
      threadId: string;
      targetPath?: string;
    }) => openDesignBoard(threadId, { targetPath }),
  });
}
