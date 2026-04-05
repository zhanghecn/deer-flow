import { useQueryClient } from "@tanstack/react-query";
import { AlertCircleIcon, FileCodeIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { buildWorkspaceAgentSettingsPath, publishAgent, type AgentStatus } from "@/core/agents";
import {
  createAgentAuthoringDraft,
  createSkillAuthoringDraft,
  listAuthoringFiles,
  readAuthoringFile,
  saveAgentAuthoringDraft,
  saveSkillAuthoringDraft,
  writeAuthoringFile,
  type AuthoringDraft,
  type AuthoringFileEntry,
} from "@/core/authoring";
import { useI18n } from "@/core/i18n/hooks";
import { uuid } from "@/core/utils/uuid";

import { CodeEditor } from "../code-editor";

import { AuthoringActions } from "./authoring-actions";
import { AuthoringFileTree } from "./authoring-file-tree";
import { getAuthoringWorkbenchText } from "./authoring-workbench.i18n";

const AUTHORING_THREAD_STORAGE_PREFIX = "openagents:authoring-thread:";

type FileBuffer = {
  savedValue: string;
  draftValue: string;
};

function readStoredAuthoringThreadId(key: string) {
  if (typeof window === "undefined") {
    return null;
  }
  return window.sessionStorage.getItem(`${AUTHORING_THREAD_STORAGE_PREFIX}${key}`);
}

function getOrCreateAuthoringThreadId(key: string) {
  const existing = readStoredAuthoringThreadId(key);
  if (existing) {
    return existing;
  }
  const nextThreadId = uuid();
  if (typeof window !== "undefined") {
    window.sessionStorage.setItem(
      `${AUTHORING_THREAD_STORAGE_PREFIX}${key}`,
      nextThreadId,
    );
  }
  return nextThreadId;
}

function buildAuthoringThreadKey(target: {
  kind: "agent" | "skill";
  name: string;
  agentStatus?: AgentStatus;
  sourcePath?: string;
}) {
  return [
    target.kind,
    target.name,
    target.agentStatus ?? "",
    target.sourcePath ?? "",
  ].join(":");
}

function pickInitialFile(draft: AuthoringDraft) {
  return (
    draft.files.find((entry) => !entry.is_dir && entry.name === "AGENTS.md")?.path ??
    draft.files.find((entry) => !entry.is_dir && entry.name === "SKILL.md")?.path ??
    draft.files.find((entry) => !entry.is_dir)?.path ??
    null
  );
}

function normalizeRelativeFilePath(value: string) {
  const trimmed = value.trim().replace(/^\/+/, "");
  if (!trimmed || trimmed.endsWith("/")) {
    return null;
  }
  const segments = trimmed.split("/").filter(Boolean);
  if (
    segments.length === 0 ||
    segments.some((segment) => segment === "." || segment === "..")
  ) {
    return null;
  }
  return segments.join("/");
}

function joinVirtualPath(rootPath: string, relativePath: string) {
  return `${rootPath.replace(/\/+$/, "")}/${relativePath.replace(/^\/+/, "")}`;
}

function parentDirectory(path: string) {
  const index = path.lastIndexOf("/");
  return index > 0 ? path.slice(0, index) : path;
}

function directoryChain(rootPath: string, filePath: string) {
  const directories = [rootPath];
  let current = parentDirectory(filePath);
  while (current.startsWith(rootPath) && current !== rootPath) {
    directories.push(current);
    current = parentDirectory(current);
  }
  return directories;
}

export function AuthoringWorkbench({
  target,
}: {
  target:
    | { kind: "agent"; name: string; agentStatus: AgentStatus }
    | { kind: "skill"; name: string; sourcePath?: string };
}) {
  const { locale } = useI18n();
  const text = getAuthoringWorkbenchText(locale);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [draft, setDraft] = useState<AuthoringDraft | null>(null);
  const [entriesByDir, setEntriesByDir] = useState<Record<string, AuthoringFileEntry[]>>({});
  const [expandedDirs, setExpandedDirs] = useState<Record<string, boolean>>({});
  const [buffers, setBuffers] = useState<Record<string, FileBuffer>>({});
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [newFilePath, setNewFilePath] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const targetKind = target.kind;
  const targetName = target.name;
  const targetStatus = target.kind === "agent" ? target.agentStatus : undefined;
  const targetSourcePath =
    target.kind === "skill" ? target.sourcePath : undefined;

  const threadId = useMemo(() => {
    const explicitThreadId = searchParams.get("thread_id")?.trim();
    if (explicitThreadId) {
      return explicitThreadId;
    }
    return getOrCreateAuthoringThreadId(
      buildAuthoringThreadKey({
        kind: targetKind,
        name: targetName,
        agentStatus: targetStatus,
        sourcePath: targetSourcePath,
      }),
    );
  }, [searchParams, targetKind, targetName, targetSourcePath, targetStatus]);

  const loadDirectory = useCallback(
    async (path: string) => {
      const files = await listAuthoringFiles(threadId, path);
      setEntriesByDir((current) => ({ ...current, [path]: files }));
      return files;
    },
    [threadId],
  );

  const loadFile = useCallback(
    async (path: string) => {
      if (buffers[path]) {
        setSelectedPath(path);
        return;
      }
      const payload = await readAuthoringFile(threadId, path);
      setBuffers((current) => ({
        ...current,
        [path]: {
          savedValue: payload.content,
          draftValue: payload.content,
        },
      }));
      setSelectedPath(path);
    },
    [buffers, threadId],
  );

  useEffect(() => {
    let cancelled = false;

    async function openDraft() {
      setIsLoading(true);
      setError(null);
      try {
        const nextDraft =
          targetKind === "agent"
            ? await createAgentAuthoringDraft(targetName, {
                thread_id: threadId,
                agent_status: targetStatus,
              })
            : await createSkillAuthoringDraft(targetName, {
                thread_id: threadId,
                source_path: targetSourcePath,
              });
        if (cancelled) {
          return;
        }
        setDraft(nextDraft);
        setEntriesByDir({ [nextDraft.root_path]: nextDraft.files });
        setExpandedDirs({ [nextDraft.root_path]: true });
        setBuffers({});

        const initialFile = pickInitialFile(nextDraft);
        setSelectedPath(initialFile);
        if (initialFile) {
          const payload = await readAuthoringFile(threadId, initialFile);
          if (cancelled) {
            return;
          }
          setBuffers({
            [initialFile]: {
              savedValue: payload.content,
              draftValue: payload.content,
            },
          });
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void openDraft();
    return () => {
      cancelled = true;
    };
  }, [targetKind, targetName, targetSourcePath, targetStatus, threadId]);

  const hasDirtyChanges = useMemo(
    () =>
      Object.values(buffers).some(
        (buffer) => buffer.draftValue !== buffer.savedValue,
      ),
    [buffers],
  );

  useEffect(() => {
    if (!hasDirtyChanges) {
      return;
    }
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = text.unsavedChanges;
      return text.unsavedChanges;
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [hasDirtyChanges, text.unsavedChanges]);

  const currentBuffer = selectedPath ? buffers[selectedPath] : null;

  const handleToggleDirectory = useCallback(
    async (path: string) => {
      const nextExpanded = !(expandedDirs[path] ?? false);
      setExpandedDirs((current) => ({ ...current, [path]: nextExpanded }));
      if (nextExpanded && !entriesByDir[path]) {
        try {
          await loadDirectory(path);
        } catch (directoryError) {
          toast.error(
            directoryError instanceof Error
              ? directoryError.message
              : String(directoryError),
          );
        }
      }
    },
    [entriesByDir, expandedDirs, loadDirectory],
  );

  const handleSelectFile = useCallback(
    async (path: string) => {
      try {
        await loadFile(path);
      } catch (fileError) {
        toast.error(
          fileError instanceof Error ? fileError.message : String(fileError),
        );
      }
    },
    [loadFile],
  );

  const writeDirtyBuffers = useCallback(async () => {
    const dirtyEntries = Object.entries(buffers).filter(
      ([, buffer]) => buffer.draftValue !== buffer.savedValue,
    );
    for (const [path, buffer] of dirtyEntries) {
      await writeAuthoringFile({
        thread_id: threadId,
        path,
        content: buffer.draftValue,
      });
    }
    if (dirtyEntries.length > 0) {
      setBuffers((current) =>
        Object.fromEntries(
          Object.entries(current).map(([path, buffer]) => [
            path,
            {
              savedValue: buffer.draftValue,
              draftValue: buffer.draftValue,
            },
          ]),
        ),
      );
    }
  }, [buffers, threadId]);

  const saveDraftChanges = useCallback(async () => {
    if (!draft) {
      return;
    }
    await writeDirtyBuffers();
    if (targetKind === "agent") {
      await saveAgentAuthoringDraft(targetName, {
        thread_id: threadId,
        agent_status: targetStatus,
      });
      await queryClient.invalidateQueries({ queryKey: ["agents"] });
      await queryClient.invalidateQueries({
        queryKey: ["agents", targetName, targetStatus],
      });
      return;
    }
    await saveSkillAuthoringDraft(targetName, {
      thread_id: threadId,
    });
    await queryClient.invalidateQueries({ queryKey: ["skills"] });
    await queryClient.invalidateQueries({
      queryKey: ["skills", targetName],
    });
  }, [
    draft,
    queryClient,
    targetKind,
    targetName,
    targetStatus,
    threadId,
    writeDirtyBuffers,
  ]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      await saveDraftChanges();
      toast.success(text.saveSuccess(targetName));
    } catch (saveError) {
      toast.error(
        saveError instanceof Error ? saveError.message : String(saveError),
      );
    } finally {
      setIsSaving(false);
    }
  }, [saveDraftChanges, targetName, text]);

  const handlePublish = useCallback(async () => {
    if (targetKind !== "agent" || targetStatus !== "dev") {
      return;
    }
    setIsPublishing(true);
    try {
      await saveDraftChanges();
      await publishAgent(targetName);
      await queryClient.invalidateQueries({ queryKey: ["agents"] });
      await queryClient.invalidateQueries({
        queryKey: ["agents", targetName, "prod"],
      });
      toast.success(text.publishSuccess(targetName));
    } catch (publishError) {
      toast.error(
        publishError instanceof Error ? publishError.message : String(publishError),
      );
    } finally {
      setIsPublishing(false);
    }
  }, [queryClient, saveDraftChanges, targetKind, targetName, targetStatus, text]);

  const handleCreateFile = useCallback(async () => {
    if (targetKind !== "skill" || !draft) {
      return;
    }
    const normalizedPath = normalizeRelativeFilePath(newFilePath);
    if (!normalizedPath) {
      toast.error(text.invalidFilePath);
      return;
    }

    const fullPath = joinVirtualPath(draft.root_path, normalizedPath);
    try {
      await writeAuthoringFile({
        thread_id: threadId,
        path: fullPath,
        content: "",
      });

      const nextDirectories = directoryChain(draft.root_path, fullPath);
      for (const directory of nextDirectories) {
        const files = await listAuthoringFiles(threadId, directory);
        setEntriesByDir((current) => ({ ...current, [directory]: files }));
      }
      setExpandedDirs((current) =>
        nextDirectories.reduce<Record<string, boolean>>(
          (accumulator, directory) => {
            accumulator[directory] = true;
            return accumulator;
          },
          { ...current },
        ),
      );
      setBuffers((current) => ({
        ...current,
        [fullPath]: {
          savedValue: "",
          draftValue: "",
        },
      }));
      setSelectedPath(fullPath);
      setNewFilePath("");
      toast.success(text.fileCreated(normalizedPath));
    } catch (createError) {
      toast.error(
        createError instanceof Error ? createError.message : String(createError),
      );
    }
  }, [draft, newFilePath, targetKind, text, threadId]);

  const handleBack = useCallback(() => {
    if (hasDirtyChanges && !window.confirm(text.unsavedChanges)) {
      return;
    }
    if (targetKind === "agent") {
      void navigate(
        buildWorkspaceAgentSettingsPath({
          agentName: targetName,
          agentStatus: targetStatus,
        }),
      );
      return;
    }
    void navigate("/workspace/agents");
  }, [hasDirtyChanges, navigate, targetKind, targetName, targetStatus, text.unsavedChanges]);

  const handleEditorChange = useCallback(
    (value: string) => {
      if (!selectedPath) {
        return;
      }
      setBuffers((current) => {
        const existing = current[selectedPath];
        if (!existing) {
          return current;
        }
        return {
          ...current,
          [selectedPath]: {
            ...existing,
            draftValue: value,
          },
        };
      });
    },
    [selectedPath],
  );

  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
        {text.loading}
      </div>
    );
  }

  if (error || !draft) {
    return (
      <div className="flex h-full w-full items-center justify-center p-6">
        <Alert variant="destructive" className="max-w-xl">
          <AlertCircleIcon />
          <AlertTitle>{text.loadErrorTitle}</AlertTitle>
          <AlertDescription>{error ?? text.loadErrorTitle}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="h-full w-full p-4 md:p-6">
      <ResizablePanelGroup
        orientation="horizontal"
        className="min-h-0 rounded-[28px] border bg-muted/20 p-3"
      >
        <ResizablePanel defaultSize={22} minSize={18}>
          <AuthoringFileTree
            title={text.fileTree}
            rootPath={draft.root_path}
            entriesByDir={entriesByDir}
            expandedDirs={expandedDirs}
            selectedPath={selectedPath}
            onSelectFile={(path) => void handleSelectFile(path)}
            onToggleDirectory={(path) => void handleToggleDirectory(path)}
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={53} minSize={32}>
          <div className="bg-background flex h-full min-h-0 flex-col rounded-3xl border">
            <div className="border-b px-5 py-4">
              <div className="flex items-center gap-2">
                <FileCodeIcon className="size-4 text-muted-foreground" />
                <div className="truncate text-sm font-semibold">
                  {selectedPath ?? targetName}
                </div>
              </div>
            </div>
            <div className="min-h-0 flex-1">
              {selectedPath && currentBuffer ? (
                <CodeEditor
                  className="h-full rounded-none"
                  value={currentBuffer.draftValue}
                  onChange={handleEditorChange}
                  settings={{ lineNumbers: true }}
                />
              ) : (
                <div className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
                  {text.emptyEditor}
                </div>
              )}
            </div>
          </div>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={25} minSize={20}>
          <AuthoringActions
            text={text}
            kind={targetKind}
            status={targetStatus}
            sourcePath={targetSourcePath}
            rootPath={draft.root_path}
            threadId={threadId}
            isDirty={hasDirtyChanges}
            isSaving={isSaving}
            isPublishing={isPublishing}
            canPublish={targetKind === "agent" && targetStatus === "dev"}
            newFilePath={newFilePath}
            onNewFilePathChange={setNewFilePath}
            onCreateFile={() => void handleCreateFile()}
            onSave={() => void handleSave()}
            onPublish={() => void handlePublish()}
            onBack={handleBack}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
