import {
  BookOpenTextIcon,
  BrainCircuitIcon,
  CheckCircle2Icon,
  CheckIcon,
  FilesIcon,
  FolderIcon,
  LoaderIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { attachKnowledgeBaseToThread } from "@/core/knowledge/api";
import { useKnowledgeLibrary } from "@/core/knowledge/hooks";
import { useI18n } from "@/core/i18n/hooks";
import type { KnowledgeSelection } from "@/core/knowledge/types";
import { cn } from "@/lib/utils";

type KnowledgeLibraryDocument = KnowledgeSelection & {
  description?: string;
  locatorType: string;
  fileKind: string;
  attachedToThread: boolean;
};

type KnowledgeLibraryGroup = {
  ownerName: string;
  documents: KnowledgeLibraryDocument[];
};

const sectionLabelClassName =
  "text-muted-foreground text-[11px] font-medium uppercase tracking-[0.22em]";

export function KnowledgeSelectorDialog({
  threadId,
  value,
  disabled,
  onChange,
}: {
  threadId: string;
  value: KnowledgeSelection[];
  disabled?: boolean;
  onChange: (value: KnowledgeSelection[]) => void;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { knowledgeBases, isLoading } = useKnowledgeLibrary(threadId);
  const [open, setOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [draftIds, setDraftIds] = useState<string[]>([]);

  const documents = useMemo<KnowledgeLibraryDocument[]>(
    () =>
      knowledgeBases.flatMap((knowledgeBase) =>
        knowledgeBase.documents.map((document) => ({
          documentId: document.id,
          documentName: document.display_name,
          knowledgeBaseId: knowledgeBase.id,
          knowledgeBaseName: knowledgeBase.name,
          ownerName: knowledgeBase.owner_name,
          description: document.doc_description,
          locatorType: document.locator_type,
          fileKind: document.file_kind,
          attachedToThread: knowledgeBase.attached_to_thread,
        })),
      ),
    [knowledgeBases],
  );

  const groupedDocuments = useMemo<KnowledgeLibraryGroup[]>(() => {
    const groups = new Map<string, KnowledgeLibraryDocument[]>();
    documents.forEach((document) => {
      const existing = groups.get(document.ownerName) ?? [];
      existing.push(document);
      groups.set(document.ownerName, existing);
    });

    return Array.from(groups.entries())
      .sort(([leftName], [rightName]) => leftName.localeCompare(rightName))
      .map(([ownerName, grouped]) => ({
        ownerName,
        documents: [...grouped].sort((leftDocument, rightDocument) => {
          const leftKey = `${leftDocument.knowledgeBaseName}/${leftDocument.documentName}`;
          const rightKey = `${rightDocument.knowledgeBaseName}/${rightDocument.documentName}`;
          return leftKey.localeCompare(rightKey);
        }),
      }));
  }, [documents]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setDraftIds(value.map((item) => item.documentId));
  }, [open, value]);

  const selectedCount = value.length;

  const handleToggle = (documentId: string) => {
    setDraftIds((current) =>
      current.includes(documentId)
        ? current.filter((item) => item !== documentId)
        : current.concat(documentId),
    );
  };

  const handleApply = async () => {
    setApplying(true);
    try {
      const nextSelections = documents.filter((document) =>
        draftIds.includes(document.documentId),
      );
      const baseIds = Array.from(
        new Set(nextSelections.map((document) => document.knowledgeBaseId)),
      );
      await Promise.all(
        baseIds.map((knowledgeBaseId) =>
          attachKnowledgeBaseToThread(threadId, knowledgeBaseId),
        ),
      );
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["thread-knowledge-bases", threadId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["knowledge-library", threadId],
        }),
      ]);
      onChange(
        nextSelections.map((document) => ({
          documentId: document.documentId,
          documentName: document.documentName,
          knowledgeBaseId: document.knowledgeBaseId,
          knowledgeBaseName: document.knowledgeBaseName,
          ownerName: document.ownerName,
        })),
      );
      setOpen(false);
      toast.success(
        nextSelections.length > 0
          ? t.knowledge.selector.appliedCount(nextSelections.length)
          : t.knowledge.selector.applied,
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t.knowledge.selector.attachError,
      );
    } finally {
      setApplying(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        className={cn(
          "border-border/70 bg-background/70 hover:bg-background/85 gap-2 rounded-full px-3 shadow-sm",
          selectedCount > 0 &&
            "border-primary/30 bg-primary/6 text-foreground hover:bg-primary/10",
        )}
        onClick={() => setOpen(true)}
      >
        <BrainCircuitIcon className="size-4" />
        <span className="text-xs font-medium">
          {selectedCount > 0
            ? t.knowledge.selector.selectedCount(selectedCount)
            : t.knowledge.selector.button}
        </span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="overflow-hidden border-border/70 bg-background/95 p-0 sm:max-w-4xl">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.1),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.08),transparent_28%)]" />

          <div className="relative">
            <DialogHeader className="border-border/60 border-b px-6 py-6">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-3">
                  <div className={sectionLabelClassName}>
                    {t.knowledge.sectionTitle}
                  </div>
                  <div className="space-y-2">
                    <DialogTitle className="font-serif text-2xl font-semibold tracking-tight md:text-3xl">
                      {t.knowledge.selector.title}
                    </DialogTitle>
                    <DialogDescription className="max-w-2xl text-sm leading-7">
                      {t.knowledge.selector.description}
                    </DialogDescription>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="border-border/70 bg-background/75 flex items-center gap-3 rounded-[20px] border px-4 py-3 shadow-sm">
                    <div className="bg-primary/10 text-primary flex size-10 items-center justify-center rounded-2xl">
                      <FilesIcon className="size-4" />
                    </div>
                    <div className="text-sm font-medium">
                      {t.knowledge.documentCount(documents.length)}
                    </div>
                  </div>
                  <div className="border-border/70 bg-background/75 flex items-center gap-3 rounded-[20px] border px-4 py-3 shadow-sm">
                    <div className="bg-primary/10 text-primary flex size-10 items-center justify-center rounded-2xl">
                      <CheckCircle2Icon className="size-4" />
                    </div>
                    <div className="text-sm font-medium">
                      {t.knowledge.selector.selectedCount(draftIds.length)}
                    </div>
                  </div>
                </div>
              </div>
            </DialogHeader>

            <Command className="bg-transparent">
              <CommandInput
                placeholder={t.knowledge.selector.searchPlaceholder}
                className="text-sm"
              />
              <CommandList className="max-h-[58vh] px-3 pb-3">
                <CommandEmpty>
                  {isLoading
                    ? t.knowledge.loadingLibrary
                    : t.knowledge.selector.empty}
                </CommandEmpty>

                {groupedDocuments.map((group) => (
                  <CommandGroup
                    key={group.ownerName}
                    heading={group.ownerName}
                    className="mb-4 rounded-[22px] border border-border/60 bg-background/55 p-2 last:mb-0 [&_[cmdk-group-heading]]:flex [&_[cmdk-group-heading]]:items-center [&_[cmdk-group-heading]]:gap-2 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.2em]"
                  >
                    {group.documents.map((document) => {
                      const selected = draftIds.includes(document.documentId);
                      return (
                        <CommandItem
                          key={document.documentId}
                          value={`${document.documentName} ${document.knowledgeBaseName} ${document.ownerName} ${document.fileKind} ${document.locatorType}`}
                          onSelect={() => handleToggle(document.documentId)}
                          className={cn(
                            "mb-2 rounded-[18px] border border-transparent bg-transparent px-3 py-3 last:mb-0",
                            selected
                              ? "border-primary/30 bg-primary/6"
                              : "hover:bg-background/90",
                          )}
                        >
                          <div className="flex min-w-0 flex-1 items-start gap-3">
                            <div
                              className={cn(
                                "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border",
                                selected
                                  ? "border-primary bg-primary text-primary-foreground"
                                  : "border-border bg-background",
                              )}
                            >
                              {selected ? <CheckIcon className="size-3" /> : null}
                            </div>

                            <div className="min-w-0 flex-1 space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="truncate text-sm font-semibold">
                                  {document.documentName}
                                </div>
                                {document.attachedToThread ? (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                                    <BookOpenTextIcon className="size-3" />
                                    {t.knowledge.attached}
                                  </span>
                                ) : null}
                              </div>
                              <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
                                <span className="inline-flex items-center gap-1">
                                  <FolderIcon className="size-3" />
                                  {document.ownerName}
                                </span>
                                <span>/</span>
                                <span>{document.knowledgeBaseName}</span>
                                <span>/</span>
                                <span className="uppercase">
                                  {document.fileKind}
                                </span>
                                <span>/</span>
                                <span>{document.locatorType}</span>
                              </div>
                              {document.description ? (
                                <div className="text-muted-foreground line-clamp-2 text-xs leading-5">
                                  {document.description}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                ))}
              </CommandList>
            </Command>

            <DialogFooter className="border-border/60 flex items-center justify-between border-t px-6 py-4">
              <div className="text-muted-foreground flex items-center gap-2 text-xs">
                <BookOpenTextIcon className="size-4" />
                <span>{t.knowledge.selector.selectedCount(draftIds.length)}</span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  className="rounded-full"
                  onClick={() => setOpen(false)}
                >
                  {t.common.cancel}
                </Button>
                <Button
                  onClick={handleApply}
                  disabled={applying}
                  className="rounded-full"
                >
                  {applying ? (
                    <LoaderIcon className="mr-2 size-4 animate-spin" />
                  ) : null}
                  {t.knowledge.selector.apply}
                </Button>
              </div>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
