import type { Dispatch, SetStateAction } from "react";
import { createContext, useCallback, useContext, useState } from "react";

import type { Subtask } from "./types";

export interface SubtaskContextValue {
  tasks: Record<string, Subtask>;
  setTasks: Dispatch<SetStateAction<Record<string, Subtask>>>;
}

export const SubtaskContext = createContext<SubtaskContextValue>({
  tasks: {},
  setTasks: () => {
    /* noop */
  },
});

export function SubtasksProvider({ children }: { children: React.ReactNode }) {
  const [tasks, setTasks] = useState<Record<string, Subtask>>({});
  return (
    <SubtaskContext.Provider value={{ tasks, setTasks }}>
      {children}
    </SubtaskContext.Provider>
  );
}

export function useSubtaskContext() {
  const context = useContext(SubtaskContext);
  if (context === undefined) {
    throw new Error(
      "useSubtaskContext must be used within a SubtaskContext.Provider",
    );
  }
  return context;
}

export function useSubtask(id: string) {
  const { tasks } = useSubtaskContext();
  return tasks[id];
}

export function useUpdateSubtask() {
  const { setTasks } = useSubtaskContext();
  const updateSubtask = useCallback(
    (task: Partial<Subtask> & { id: string }) => {
      setTasks((prevTasks) => {
        const nextTask = { ...prevTasks[task.id], ...task } as Subtask;
        const previousTask = prevTasks[task.id];

        if (
          previousTask?.status === nextTask.status &&
          previousTask?.result === nextTask.result &&
          previousTask?.error === nextTask.error &&
          previousTask?.latestMessage === nextTask.latestMessage &&
          previousTask?.prompt === nextTask.prompt &&
          previousTask?.description === nextTask.description &&
          previousTask?.subagent_type === nextTask.subagent_type
        ) {
          return prevTasks;
        }

        return {
          ...prevTasks,
          [task.id]: nextTask,
        };
      });
    },
    [setTasks],
  );
  return updateSubtask;
}
