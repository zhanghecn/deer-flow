import { useQueryClient } from "@tanstack/react-query";
import { LoaderIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/core/i18n/hooks";
import {
  createKnowledgeBase,
  createThreadKnowledgeBase,
} from "@/core/knowledge/api";

const SUPPORTED_KNOWLEDGE_EXTENSIONS = new Set([
  ".pdf",
  ".doc",
  ".docx",
  ".ppt",
  ".pptx",
  ".md",
  ".markdown",
]);
type DirectoryInputElement = HTMLInputElement & {
  webkitdirectory?: boolean;
  directory?: boolean;
};
type KnowledgeFileWithRelativePath = File & {
  webkitRelativePath?: string;
};

function stripFileExtension(filename: string) {
  return filename.replace(/\.[^.]+$/, "").trim();
}

function fileExtensionOf(filename: string) {
  const normalized = filename.trim().toLowerCase();
  const dotIndex = normalized.lastIndexOf(".");
  return dotIndex >= 0 ? normalized.slice(dotIndex) : "";
}

function splitKnowledgeFiles(files: File[]) {
  const acceptedFiles: File[] = [];
  const rejectedFiles: File[] = [];

  files.forEach((file) => {
    if (SUPPORTED_KNOWLEDGE_EXTENSIONS.has(fileExtensionOf(file.name))) {
      acceptedFiles.push(file);
      return;
    }
    rejectedFiles.push(file);
  });

  return { acceptedFiles, rejectedFiles };
}

function knowledgeFileDisplayName(file: File) {
  const relativePath = (file as KnowledgeFileWithRelativePath)
    .webkitRelativePath?.trim();
  return relativePath && relativePath.length > 0 ? relativePath : file.name;
}

function formatKnowledgeFileSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function configureDirectoryInput(node: HTMLInputElement | null) {
  if (!node) {
    return;
  }

  // React's input typings do not expose the Chromium directory picker flags,
  // but the backend relies on webkitRelativePath to preserve source identity
  // for folder imports with repeated names such as many `cases.md` files.
  const directoryInput = node as DirectoryInputElement;
  directoryInput.webkitdirectory = true;
  directoryInput.directory = true;
  node.setAttribute("webkitdirectory", "");
  node.setAttribute("directory", "");
}

function resolveKnowledgeBaseName(
  rawName: string,
  files: File[],
  fallbackName: string,
) {
  const trimmedName = rawName.trim();
  if (trimmedName) {
    return trimmedName;
  }

  const primaryFile = files[0]?.name?.trim();
  if (!primaryFile) {
    return fallbackName;
  }

  const primaryLabel = stripFileExtension(primaryFile) || fallbackName;
  if (files.length === 1) {
    return primaryLabel;
  }

  return `${primaryLabel} +${files.length - 1}`;
}

export function KnowledgeBaseUploadDialog({
  threadId,
  open,
  onOpenChange,
  onUploaded,
  ensureThreadExists,
}: {
  threadId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploaded?: (payload: {
    knowledgeBaseId: string;
    knowledgeBaseName: string;
  }) => void;
  ensureThreadExists?: () => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [rejectedFiles, setRejectedFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const selectedTotalSize = useMemo(
    () => files.reduce((total, file) => total + file.size, 0),
    [files],
  );

  const handleSelectedFiles = (nextFiles: File[]) => {
    const { acceptedFiles, rejectedFiles: nextRejectedFiles } =
      splitKnowledgeFiles(nextFiles);

    // Browser accept filters are only advisory; keep a client-side guard so
    // unsupported files fail early with actionable feedback.
    setFiles(acceptedFiles);
    setRejectedFiles(nextRejectedFiles);

    if (nextRejectedFiles.length > 0) {
      toast.error(
        t.knowledge.unsupportedFilesSelected(nextRejectedFiles.length),
      );
    }
  };

  useEffect(() => {
    if (open) {
      return;
    }
    setName("");
    setDescription("");
    setFiles([]);
    setRejectedFiles([]);
    setSubmitting(false);
  }, [open]);

  const handleCreate = async () => {
    if (files.length === 0) {
      toast.error(t.knowledge.chooseAtLeastOneFile);
      return;
    }

    setSubmitting(true);
    const resolvedName = resolveKnowledgeBaseName(
      name,
      files,
      t.knowledge.defaultBaseName,
    );

    try {
      if (threadId) {
        // Thread knowledge uploads define the same persisted attachment scope
        // that first-turn retrieval depends on, so new-chat drafts must be
        // materialized before the upload request is sent.
        await ensureThreadExists?.();
      }

      const response = threadId
        ? await createThreadKnowledgeBase(threadId, {
          name: resolvedName,
          description: description.trim(),
          files,
        })
        : await createKnowledgeBase({
            name: resolvedName,
            description: description.trim(),
            files,
          });

      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["knowledge-library"],
        }),
        ...(threadId
          ? [
              queryClient.invalidateQueries({
                queryKey: ["thread-knowledge-bases", threadId],
              }),
            ]
          : []),
      ]);

      onUploaded?.({
        knowledgeBaseId: response.knowledge_base_id,
        knowledgeBaseName: resolvedName,
      });
      onOpenChange(false);
      toast.success(t.knowledge.preparationQueued);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t.knowledge.createError,
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.knowledge.newTitle}</DialogTitle>
          <DialogDescription>
            {threadId
              ? t.knowledge.newDescription
              : t.knowledge.newDescriptionGlobal}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t.knowledge.namePlaceholder}
          />
          <Textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={t.knowledge.descriptionPlaceholder}
            rows={4}
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <div className="text-muted-foreground text-xs font-medium">
                {t.knowledge.chooseFilesLabel}
              </div>
              <Input
                aria-label={t.knowledge.chooseFilesLabel}
                type="file"
                multiple
                accept=".pdf,.doc,.docx,.ppt,.pptx,.md,.markdown"
                onChange={(event) =>
                  handleSelectedFiles(Array.from(event.target.files ?? []))
                }
              />
            </div>
            <div className="space-y-1">
              <div className="text-muted-foreground text-xs font-medium">
                {t.knowledge.chooseFolderLabel}
              </div>
              <Input
                ref={configureDirectoryInput}
                aria-label={t.knowledge.chooseFolderLabel}
                type="file"
                multiple
                accept=".pdf,.doc,.docx,.ppt,.pptx,.md,.markdown"
                onChange={(event) =>
                  handleSelectedFiles(Array.from(event.target.files ?? []))
                }
              />
            </div>
          </div>
          <p className="text-muted-foreground text-xs leading-5">
            {t.knowledge.supportedFormatsHint}
          </p>
          {files.length > 0 ? (
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border px-3 py-2 pr-1 text-xs">
              <div className="font-medium">
                {t.knowledge.selectedFileCount(files.length)}
              </div>
              <div className="text-muted-foreground">
                {t.knowledge.selectedFileSize(
                  formatKnowledgeFileSize(selectedTotalSize),
                )}
              </div>
              {files.map((file) => (
                <div
                  key={`${knowledgeFileDisplayName(file)}:${file.size}:${file.lastModified}`}
                  className="text-muted-foreground truncate"
                >
                  {knowledgeFileDisplayName(file)}
                </div>
              ))}
            </div>
          ) : null}
          {rejectedFiles.length > 0 ? (
            <div className="space-y-1 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs">
              <div className="font-medium text-red-600 dark:text-red-400">
                {t.knowledge.rejectedFileCount(rejectedFiles.length)}
              </div>
              {rejectedFiles.map((file) => (
                <div
                  key={`${file.name}:${file.size}:rejected`}
                  className="truncate text-red-600/80 dark:text-red-400/80"
                >
                  {file.name}
                </div>
              ))}
            </div>
          ) : null}
          <p className="text-muted-foreground text-xs leading-5">
            {threadId
              ? t.knowledge.uploadNextStepThread
              : t.knowledge.uploadNextStepLibrary}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t.common.cancel}
          </Button>
          <Button onClick={handleCreate} disabled={submitting}>
            {submitting ? (
              <LoaderIcon className="mr-2 size-4 animate-spin" />
            ) : null}
            {t.common.create}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
