import type { RuntimeSurfaceStatus } from "@/core/workspace-surface/types";

export function isRuntimeSurfaceBusy(status: RuntimeSurfaceStatus): boolean {
  return status === "opening";
}
