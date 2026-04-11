import { useQueryClient } from "@tanstack/react-query";
import { LoaderIcon } from "lucide-react";
import { useEffect, useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/core/i18n/hooks";
import {
  createKnowledgeBase,
  createThreadKnowledgeBase,
} from "@/core/knowledge/api";
import { useModels } from "@/core/models/hooks";
import {
  findAvailableModelName,
  normalizeModelName,
} from "@/core/models/selection";
import { getLocalSettings } from "@/core/settings";

function stripFileExtension(filename: string) {
  return filename.replace(/\.[^.]+$/, "").trim();
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

function resolveInitialModelName(
  currentModelName: string,
  defaultModelName: string | undefined,
  models: { name: string }[],
) {
  const configuredModelName = findAvailableModelName(
    models,
    currentModelName,
    defaultModelName,
    getLocalSettings().context.model_name,
  );
  return (normalizeModelName(configuredModelName) || models[0]?.name) ?? "";
}

export function KnowledgeBaseUploadDialog({
  threadId,
  open,
  onOpenChange,
  onUploaded,
  defaultModelName,
  ensureThreadExists,
}: {
  threadId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploaded?: (payload: {
    knowledgeBaseId: string;
    knowledgeBaseName: string;
  }) => void;
  defaultModelName?: string;
  ensureThreadExists?: () => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const { models, isLoading: modelsLoading } = useModels({ enabled: open });
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [selectedModelName, setSelectedModelName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      return;
    }
    setName("");
    setDescription("");
    setFiles([]);
    setSelectedModelName("");
    setSubmitting(false);
  }, [open]);

  useEffect(() => {
    if (!open || models.length === 0) {
      return;
    }

    setSelectedModelName((current) =>
      resolveInitialModelName(current, defaultModelName, models),
    );
  }, [defaultModelName, models, open]);

  const handleCreate = async () => {
    if (files.length === 0) {
      toast.error(t.knowledge.chooseAtLeastOneFile);
      return;
    }

    const selectedModel = models.find(
      (model) => model.name === selectedModelName,
    );
    if (!selectedModel) {
      toast.error(t.knowledge.invalidSelectedModel);
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
            modelName: selectedModel.name,
            files,
          })
        : await createKnowledgeBase({
            name: resolvedName,
            description: description.trim(),
            modelName: selectedModel.name,
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
      toast.success(t.knowledge.indexQueued);
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
          <div className="space-y-1.5">
            <div className="text-sm font-medium">{t.knowledge.modelLabel}</div>
            <Select
              value={selectedModelName}
              onValueChange={setSelectedModelName}
              disabled={submitting || modelsLoading || models.length === 0}
            >
              <SelectTrigger className="w-full">
                <SelectValue
                  placeholder={
                    modelsLoading
                      ? t.common.loading
                      : t.knowledge.modelPlaceholder
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {models.map((model) => (
                  <SelectItem key={model.name} value={model.name}>
                    {model.display_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
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
          <Input
            type="file"
            multiple
            accept=".pdf,.doc,.docx,.md,.markdown"
            onChange={(event) => {
              setFiles(Array.from(event.target.files ?? []));
            }}
          />
          {files.length > 0 ? (
            <div className="space-y-1 text-xs">
              {files.map((file) => (
                <div
                  key={`${file.name}:${file.size}`}
                  className="text-muted-foreground truncate"
                >
                  {file.name}
                </div>
              ))}
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t.common.cancel}
          </Button>
          <Button
            onClick={handleCreate}
            disabled={submitting || modelsLoading || selectedModelName === ""}
          >
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
