export const WORKBENCH_CONTEXT_KEY = "demo_workbench_context";

export type DemoWorkbenchContext = {
  selectedPath: string;
  baseURL: string;
  contentKind?: string | null;
  mimeType?: string | null;
};

function getStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function loadWorkbenchContext(): DemoWorkbenchContext | null {
  const storage = getStorage();
  if (!storage) return null;
  const raw = storage.getItem(WORKBENCH_CONTEXT_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DemoWorkbenchContext;
  } catch {
    return null;
  }
}

export function saveWorkbenchContext(context: DemoWorkbenchContext | null) {
  const storage = getStorage();
  if (!storage) return;
  if (!context || !context.selectedPath.trim()) {
    storage.removeItem(WORKBENCH_CONTEXT_KEY);
    return;
  }
  storage.setItem(WORKBENCH_CONTEXT_KEY, JSON.stringify(context));
}
