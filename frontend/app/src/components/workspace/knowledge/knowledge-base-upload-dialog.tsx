import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { LoaderIcon } from "lucide-react";
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
import {
  createKnowledgeBase,
  createThreadKnowledgeBase,
} from "@/core/knowledge/api";
import { useI18n } from "@/core/i18n/hooks";
import { getLocalSettings } from "@/core/settings";

export function KnowledgeBaseUploadDialog({
  threadId,
  open,
  onOpenChange,
  onUploaded,
}: {
  threadId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploaded?: (payload: {
    knowledgeBaseId: string;
    knowledgeBaseName: string;
  }) => void;
}) {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      return;
    }
    setName("");
    setDescription("");
    setFiles([]);
    setSubmitting(false);
  }, [open]);

  const handleCreate = async () => {
    if (files.length === 0) {
      toast.error(t.knowledge.chooseAtLeastOneFile);
      return;
    }

    setSubmitting(true);
    const configuredModelName = getLocalSettings().context.model_name;
    const selectedModelName =
      typeof configuredModelName === "string" ? configuredModelName : undefined;
    const resolvedName = name.trim() || t.knowledge.defaultBaseName;

    try {
      const response = threadId
        ? await createThreadKnowledgeBase(threadId, {
            name: resolvedName,
            description: description.trim(),
            modelName: selectedModelName,
            files,
          })
        : await createKnowledgeBase({
            name: resolvedName,
            description: description.trim(),
            modelName: selectedModelName,
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
