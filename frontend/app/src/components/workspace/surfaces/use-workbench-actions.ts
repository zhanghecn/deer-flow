import { useCallback } from "react";
import { toast } from "sonner";

import { useArtifacts } from "@/components/workspace/artifacts/context";
import { useI18n } from "@/core/i18n/hooks";
import { useOpenRuntimeWorkspace } from "@/core/runtime-workspaces/hooks";
import { useWorkspaceSurface } from "@/core/workspace-surface/context";

function openExternalWorkspace(relativeUrl: string) {
  const openedWindow = window.open(relativeUrl, "_blank");
  if (!openedWindow) {
    window.location.assign(relativeUrl);
  }
}

export function useWorkbenchActions(threadId: string) {
  const { t } = useI18n();
  const {
    artifacts,
    selectedArtifact,
    select,
    setOpen: setArtifactsOpen,
  } = useArtifacts();
  const {
    noteRuntimeSession,
    openSurface,
    rememberThreadHint,
    runtimeState,
    setRuntimeStatus,
    threadHint,
  } = useWorkspaceSurface();
  const openRuntimeWorkspace = useOpenRuntimeWorkspace();

  const openArtifactWorkspace = useCallback(
    (artifactPath?: string) => {
      const resolvedArtifactPath =
        artifactPath ?? selectedArtifact ?? undefined;

      if (artifactPath) {
        select(artifactPath);
      }
      setArtifactsOpen(true);

      // Files stay lightweight inside the dock. Prefer the focused preview when
      // a concrete artifact is known, otherwise open the inventory list first.
      const shouldOpenPreview = Boolean(resolvedArtifactPath);
      rememberThreadHint({
        surface: shouldOpenPreview ? "preview" : "files",
        artifactPath: resolvedArtifactPath,
      });
      openSurface(shouldOpenPreview ? "preview" : "files");
    },
    [
      openSurface,
      rememberThreadHint,
      select,
      selectedArtifact,
      setArtifactsOpen,
    ],
  );

  const openRuntimeWorkbench = useCallback(
    async (
      options: {
        forceRefresh?: boolean;
      } = {},
    ) => {
      const { forceRefresh = false } = options;
      const targetPath =
        runtimeState.target_path ??
        runtimeState.session?.target_path ??
        threadHint?.target_path;

      rememberThreadHint({
        surface: "runtime",
        targetPath: targetPath ?? undefined,
      });

      if (runtimeState.session && !forceRefresh) {
        openSurface("runtime");
        openExternalWorkspace(runtimeState.session.relative_url);
        return;
      }

      setRuntimeStatus("opening");
      try {
        const session = await openRuntimeWorkspace.mutateAsync({ threadId });
        noteRuntimeSession(session);
        openSurface("runtime");
        openExternalWorkspace(session.relative_url);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : t.workspace.openRuntimeSurface;
        setRuntimeStatus("failed", { error: message });
        toast.error(message);
      }
    },
    [
      noteRuntimeSession,
      openRuntimeWorkspace,
      openSurface,
      rememberThreadHint,
      runtimeState.session,
      runtimeState.target_path,
      setRuntimeStatus,
      t.workspace.openRuntimeSurface,
      threadHint?.target_path,
      threadId,
    ],
  );

  return {
    artifacts,
    isOpeningRuntime: openRuntimeWorkspace.isPending,
    openArtifactWorkspace,
    openRuntimeWorkbench,
    runtimeState,
    threadHint,
  };
}
