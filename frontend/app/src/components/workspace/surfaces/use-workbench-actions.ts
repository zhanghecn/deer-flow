import { useCallback } from "react";
import { toast } from "sonner";

import { useArtifacts } from "@/components/workspace/artifacts/context";
import type { DesignBoardSession } from "@/core/design-board/api";
import {
  hasDesignBoardAutoOpened,
  markDesignBoardAutoOpened,
  openDesignBoardTab,
} from "@/core/design-board/embed";
import { useOpenDesignBoard } from "@/core/design-board/hooks";
import { isDesignDocumentPath } from "@/core/design-board/paths";
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
    designSelection,
    designState,
    noteDesignPopupBlocked,
    noteDesignSession,
    noteRuntimeSession,
    openSurface,
    rememberThreadHint,
    runtimeState,
    setDesignStatus,
    setRuntimeStatus,
    threadHint,
  } = useWorkspaceSurface();
  const openDesignBoard = useOpenDesignBoard();
  const openRuntimeWorkspace = useOpenRuntimeWorkspace();

  const focusFilesSurface = useCallback(
    (targetPath?: string) => {
      if (targetPath) {
        select(targetPath);
      }
      setArtifactsOpen(true);
      rememberThreadHint({
        surface: "files",
        artifactPath: targetPath,
      });
      openSurface("files");
    },
    [openSurface, rememberThreadHint, select, setArtifactsOpen],
  );

  const revealArtifactInInventory = useCallback(
    (_targetPath?: string) => {
      // Keep the design surface active while still exposing the `.op` file in
      // the dock inventory. Using the generic artifact selector here would
      // flip the dock back into Preview, which hides the design-status panel
      // right after the user opens the editor.
      setArtifactsOpen(true);
    },
    [setArtifactsOpen],
  );

  const focusDesignSurface = useCallback(
    (targetPath?: string) => {
      setArtifactsOpen(true);
      rememberThreadHint({
        surface: "design",
        artifactPath: targetPath,
        targetPath,
      });
      openSurface("design");
    },
    [openSurface, rememberThreadHint, setArtifactsOpen],
  );

  const openDesignSession = useCallback((session: DesignBoardSession) => {
    const openedWindow = openDesignBoardTab(session);
    if (!openedWindow) {
      return false;
    }
    return true;
  }, []);

  const resolveDesignTargetPath = useCallback(
    (requestedTargetPath?: string) => {
      const normalizedRequestedTargetPath = requestedTargetPath?.trim();
      const hintedDesignTargetPath =
        threadHint?.artifact_path &&
        isDesignDocumentPath(threadHint.artifact_path)
          ? threadHint.artifact_path
          : undefined;

      return (
        (normalizedRequestedTargetPath && normalizedRequestedTargetPath !== ""
          ? normalizedRequestedTargetPath
          : undefined) ??
        designSelection?.target_path ??
        designState.target_path ??
        designState.session?.target_path ??
        hintedDesignTargetPath ??
        threadHint?.target_path
      );
    },
    [
      designSelection?.target_path,
      designState.session?.target_path,
      designState.target_path,
      threadHint?.artifact_path,
      threadHint?.target_path,
    ],
  );

  const openDesignWorkbench = useCallback(
    async (
      options: {
        forceRefresh?: boolean;
        revealInDock?: boolean;
        targetPath?: string;
        autoOpen?: boolean;
      } = {},
    ) => {
      const {
        forceRefresh = false,
        revealInDock = false,
        targetPath,
        autoOpen = false,
      } = options;
      const resolvedTargetPath = resolveDesignTargetPath(targetPath);
      const shouldAttemptAutoOpen =
        autoOpen && !hasDesignBoardAutoOpened(threadId);

      if (revealInDock && (designSelection || designState.session)) {
        focusDesignSurface(resolvedTargetPath);
        return;
      }

      focusDesignSurface(resolvedTargetPath);
      if (resolvedTargetPath) {
        revealArtifactInInventory(resolvedTargetPath);
      }

      if (
        designState.session &&
        !forceRefresh &&
        (!resolvedTargetPath ||
          designState.session.target_path === resolvedTargetPath)
      ) {
        if (autoOpen && !shouldAttemptAutoOpen) {
          return;
        }
        const opened = openDesignSession(designState.session);
        if (opened) {
          if (!hasDesignBoardAutoOpened(threadId)) {
            markDesignBoardAutoOpened(threadId);
          }
          setDesignStatus(designState.status, {
            targetPath: designState.session.target_path,
            openIssue: null,
          });
          return;
        }

        noteDesignPopupBlocked(designState.session.target_path);
        return;
      }

      setDesignStatus("loading", {
        targetPath: resolvedTargetPath,
        openIssue: null,
      });
      try {
        const session = await openDesignBoard.mutateAsync({
          threadId,
          targetPath: resolvedTargetPath,
        });
        noteDesignSession(session);
        revealArtifactInInventory(session.target_path);
        if (autoOpen && !shouldAttemptAutoOpen) {
          return;
        }
        const opened = openDesignSession(session);
        if (opened) {
          if (!hasDesignBoardAutoOpened(threadId)) {
            markDesignBoardAutoOpened(threadId);
          }
          return;
        }

        noteDesignPopupBlocked(session.target_path);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : t.workspace.openDesignEditor;
        setDesignStatus("error", {
          error: message,
          targetPath: resolvedTargetPath,
          openIssue: "open_failed",
        });
        toast.error(message);
      }
    },
    [
      designSelection,
      designState.session,
      designState.target_path,
      focusDesignSurface,
      focusFilesSurface,
      noteDesignPopupBlocked,
      noteDesignSession,
      openDesignBoard,
      openDesignSession,
      revealArtifactInInventory,
      resolveDesignTargetPath,
      setDesignStatus,
      t.workspace.openDesignEditor,
      threadId,
    ],
  );

  const openArtifactWorkspace = useCallback(
    (artifactPath?: string) => {
      const resolvedArtifactPath =
        artifactPath ?? selectedArtifact ?? undefined;
      if (resolvedArtifactPath && isDesignDocumentPath(resolvedArtifactPath)) {
        // `.op` outputs are the canonical design source, not a generic preview
        // blob. Opening them should jump straight into OpenPencil.
        void openDesignWorkbench({ targetPath: resolvedArtifactPath });
        return;
      }

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
      openDesignWorkbench,
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
    designSelection,
    designState,
    isOpeningDesign: openDesignBoard.isPending,
    isOpeningRuntime: openRuntimeWorkspace.isPending,
    openArtifactWorkspace,
    openDesignWorkbench,
    openRuntimeWorkbench,
    runtimeState,
    threadHint,
  };
}
