import { useQueryClient } from "@tanstack/react-query";
import {
  BookOpenTextIcon,
  BrainCircuitIcon,
  CheckCircle2Icon,
  CheckIcon,
  FilesIcon,
  FolderIcon,
  LoaderIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useI18n } from "@/core/i18n/hooks";
import {
  attachKnowledgeBaseToThread,
  detachKnowledgeBaseFromThread,
} from "@/core/knowledge/api";
import { useKnowledgeLibrary } from "@/core/knowledge/hooks";
import { cn } from "@/lib/utils";

type KnowledgeLibraryBase = {
  knowledgeBaseId: string;
  knowledgeBaseName: string;
  ownerName: string;
  description?: string;
  attachedToThread: boolean;
  documentCount: number;
  documentNames: string[];
  fileKinds: string[];
};

type KnowledgeLibraryGroup = {
  ownerName: string;
  bases: KnowledgeLibraryBase[];
};

const sectionLabelClassName =
  "text-muted-foreground text-[11px] font-medium uppercase tracking-[0.22em]";

function hasSameIds(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function summarizeBaseDocuments(base: KnowledgeLibraryBase) {
  const visibleDocumentNames = base.documentNames.slice(0, 2);
  const remainingCount = Math.max(base.documentNames.length - 2, 0);

  return {
    label: visibleDocumentNames.join(" · "),
    remainingCount,
  };
}

export function resolveKnowledgeBaseBindingDiff(
  attachedBaseIds: string[],
  draftBaseIds: string[],
) {
  return {
    baseIdsToAttach: draftBaseIds.filter(
      (baseId) => !attachedBaseIds.includes(baseId),
    ),
    baseIdsToDetach: attachedBaseIds.filter(
      (baseId) => !draftBaseIds.includes(baseId),
    ),
  };
}

export async function applyKnowledgeBaseBindingDiff({
  threadId,
  attachedBaseIds,
  draftBaseIds,
  ensureThreadExists,
  attach = attachKnowledgeBaseToThread,
  detach = detachKnowledgeBaseFromThread,
}: {
  threadId: string;
  attachedBaseIds: string[];
  draftBaseIds: string[];
  ensureThreadExists?: () => Promise<void>;
  attach?: typeof attachKnowledgeBaseToThread;
  detach?: typeof detachKnowledgeBaseFromThread;
}) {
  const { baseIdsToAttach, baseIdsToDetach } = resolveKnowledgeBaseBindingDiff(
    attachedBaseIds,
    draftBaseIds,
  );

  if (baseIdsToAttach.length > 0 || baseIdsToDetach.length > 0) {
    // New-chat routes start with a client-side draft thread ID. Persist the
    // backend thread before rewriting thread-scoped KB bindings so the first
    // run inherits the exact attachment set the user selected here.
    await ensureThreadExists?.();
  }

  await Promise.all([
    ...baseIdsToAttach.map((knowledgeBaseId) =>
      attach(threadId, knowledgeBaseId),
    ),
    ...baseIdsToDetach.map((knowledgeBaseId) =>
      detach(threadId, knowledgeBaseId),
    ),
  ]);

  return {
    baseIdsToAttach,
    baseIdsToDetach,
  };
}

export function KnowledgeSelectorDialog({
  threadId,
  disabled,
  ensureThreadExists,
}: {
  threadId: string;
  disabled?: boolean;
  ensureThreadExists?: () => Promise<void>;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { knowledgeBases, isLoading } = useKnowledgeLibrary(threadId, {
    readyOnly: true,
  });
  const [open, setOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [draftBaseIds, setDraftBaseIds] = useState<string[]>([]);
  const pointerToggleRef = useRef<{
    knowledgeBaseId: string;
    handled: boolean;
    at: number;
  } | null>(null);

  const bases = useMemo<KnowledgeLibraryBase[]>(
    () =>
      knowledgeBases.map((knowledgeBase) => ({
        knowledgeBaseId: knowledgeBase.id,
        knowledgeBaseName: knowledgeBase.name,
        ownerName: knowledgeBase.owner_name,
        description: knowledgeBase.description,
        attachedToThread: knowledgeBase.attached_to_thread,
        documentCount: knowledgeBase.documents.length,
        documentNames: knowledgeBase.documents.map(
          (document) => document.display_name,
        ),
        fileKinds: Array.from(
          new Set(
            knowledgeBase.documents.map((document) =>
              document.file_kind.toUpperCase(),
            ),
          ),
        ),
      })),
    [knowledgeBases],
  );

  const groupedBases = useMemo<KnowledgeLibraryGroup[]>(() => {
    const groups = new Map<string, KnowledgeLibraryBase[]>();
    bases.forEach((base) => {
      const existing = groups.get(base.ownerName) ?? [];
      existing.push(base);
      groups.set(base.ownerName, existing);
    });

    return Array.from(groups.entries())
      .sort(([leftName], [rightName]) => leftName.localeCompare(rightName))
      .map(([ownerName, grouped]) => ({
        ownerName,
        bases: [...grouped].sort((leftBase, rightBase) =>
          leftBase.knowledgeBaseName.localeCompare(rightBase.knowledgeBaseName),
        ),
      }));
  }, [bases]);

  const attachedBaseIds = useMemo(
    () =>
      bases
        .filter((base) => base.attachedToThread)
        .map((base) => base.knowledgeBaseId),
    [bases],
  );
  const selectedCount = attachedBaseIds.length;
  const totalDocumentCount = useMemo(
    () => bases.reduce((count, base) => count + base.documentCount, 0),
    [bases],
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    // Thread bindings are the persisted source of truth. The dialog only keeps
    // a temporary editing buffer while it is open, then rehydrates from the
    // server-backed attached_to_thread flags on every reopen.
    const selectableIds = new Set(bases.map((base) => base.knowledgeBaseId));
    const nextDraftBaseIds = attachedBaseIds.filter((baseId) =>
      selectableIds.has(baseId),
    );
    setDraftBaseIds((current) =>
      hasSameIds(current, nextDraftBaseIds) ? current : nextDraftBaseIds,
    );
  }, [attachedBaseIds, bases, open]);

  const handleToggle = useCallback((knowledgeBaseId: string) => {
    setDraftBaseIds((current) =>
      current.includes(knowledgeBaseId)
        ? current.filter((item) => item !== knowledgeBaseId)
        : current.concat(knowledgeBaseId),
    );
  }, []);

  const handlePointerToggle = useCallback(
    (knowledgeBaseId: string) => {
      const pointerToggle = pointerToggleRef.current;
      if (
        pointerToggle?.knowledgeBaseId === knowledgeBaseId &&
        pointerToggle.handled &&
        Date.now() - pointerToggle.at < 300
      ) {
        return;
      }
      handleToggle(knowledgeBaseId);
      pointerToggleRef.current = {
        knowledgeBaseId,
        handled: true,
        at: Date.now(),
      };
    },
    [handleToggle],
  );

  const handleSelect = useCallback(
    (knowledgeBaseId: string) => {
      const pointerToggle = pointerToggleRef.current;
      if (
        pointerToggle?.knowledgeBaseId === knowledgeBaseId &&
        pointerToggle.handled &&
        Date.now() - pointerToggle.at < 300
      ) {
        return;
      }
      handleToggle(knowledgeBaseId);
      pointerToggleRef.current = {
        knowledgeBaseId,
        handled: true,
        at: Date.now(),
      };
    },
    [handleToggle],
  );

  const handlePointerIntent = useCallback((knowledgeBaseId: string) => {
    pointerToggleRef.current = {
      knowledgeBaseId,
      handled: false,
      at: Date.now(),
    };
  }, []);

  const handleApply = useCallback(async () => {
    setApplying(true);
    try {
      // The dialog writes the full attach/detach diff so chat state stays
      // aligned with the persisted thread bindings after refreshes.
      await applyKnowledgeBaseBindingDiff({
        threadId,
        attachedBaseIds,
        draftBaseIds,
        ensureThreadExists,
      });

      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["thread-knowledge-bases", threadId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["knowledge-library", threadId],
        }),
      ]);

      setOpen(false);
      toast.success(
        draftBaseIds.length > 0
          ? t.knowledge.selector.appliedCount(draftBaseIds.length)
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
  }, [
    attachedBaseIds,
    draftBaseIds,
    ensureThreadExists,
    queryClient,
    t,
    threadId,
  ]);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        className={cn(
          "border-border bg-background hover:bg-accent/40 gap-2 rounded-md px-3 shadow-sm",
          selectedCount > 0 &&
            "border-primary/30 bg-primary/5 text-foreground hover:bg-primary/10",
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
        <DialogContent className="border-border bg-background flex max-h-[min(92vh,860px)] flex-col overflow-hidden p-0 sm:max-w-4xl">
          <div className="pointer-events-none absolute inset-0 bg-muted/30" />

          <div className="relative flex min-h-0 flex-1 flex-col">
            <DialogHeader className="border-border border-b px-6 py-6">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-3">
                  <div className={sectionLabelClassName}>
                    {t.knowledge.sectionTitle}
                  </div>
                  <div className="space-y-2">
                    <DialogTitle className="text-2xl font-semibold tracking-tight md:text-3xl">
                      {t.knowledge.selector.title}
                    </DialogTitle>
                    <DialogDescription className="max-w-2xl text-sm leading-7">
                      {t.knowledge.selector.description}
                    </DialogDescription>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="border-border bg-background flex items-center gap-3 rounded-lg border px-4 py-3">
                    <div className="bg-primary/10 text-primary flex size-10 items-center justify-center rounded-lg">
                      <FilesIcon className="size-4" />
                    </div>
                    <div className="text-sm font-medium">
                      {t.knowledge.documentCount(totalDocumentCount)}
                    </div>
                  </div>
                  <div className="border-border bg-background flex items-center gap-3 rounded-lg border px-4 py-3">
                    <div className="bg-primary/10 text-primary flex size-10 items-center justify-center rounded-lg">
                      <CheckCircle2Icon className="size-4" />
                    </div>
                    <div className="text-sm font-medium">
                      {t.knowledge.selector.selectedCount(draftBaseIds.length)}
                    </div>
                  </div>
                </div>
              </div>
            </DialogHeader>

            <Command className="flex min-h-0 flex-1 flex-col bg-transparent">
              <CommandInput
                placeholder={t.knowledge.selector.searchPlaceholder}
                className="text-sm"
              />
              <CommandList className="max-h-none flex-1 overflow-y-auto px-3 pb-3">
                <CommandEmpty>
                  {isLoading
                    ? t.knowledge.loadingLibrary
                    : t.knowledge.selector.empty}
                </CommandEmpty>

                {groupedBases.map((group) => (
                  <CommandGroup
                    key={group.ownerName}
                    heading={group.ownerName}
                    className="border-border bg-background mb-4 rounded-lg border p-2 last:mb-0 [&_[cmdk-group-heading]]:flex [&_[cmdk-group-heading]]:items-center [&_[cmdk-group-heading]]:gap-2 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:tracking-[0.2em] [&_[cmdk-group-heading]]:uppercase"
                  >
                    {group.bases.map((base) => {
                      const selected = draftBaseIds.includes(base.knowledgeBaseId);
                      const documentSummary = summarizeBaseDocuments(base);

                      return (
                        <CommandItem
                          key={base.knowledgeBaseId}
                          value={`${base.knowledgeBaseName} ${base.ownerName} ${base.documentNames.join(" ")} ${base.fileKinds.join(" ")}`}
                          aria-checked={selected}
                          data-checked={selected ? "true" : "false"}
                          onSelect={() => handleSelect(base.knowledgeBaseId)}
                          onPointerDown={() =>
                            handlePointerIntent(base.knowledgeBaseId)
                          }
                          onClick={() =>
                            handlePointerToggle(base.knowledgeBaseId)
                          }
                          className={cn(
                            // Cmdk marks the active keyboard row as
                            // `data-selected=true`, which is not the same as a
                            // persisted knowledge-base selection. Keep that
                            // focus state neutral so it cannot masquerade as a
                            // checked attachment.
                            "mb-2 cursor-pointer rounded-lg border border-transparent bg-transparent px-3 py-3 last:mb-0",
                            selected
                              ? "border-primary/30 bg-primary/5 data-[selected=true]:border-primary/30 data-[selected=true]:bg-primary/10"
                              : "hover:bg-accent/40 data-[selected=true]:border-border data-[selected=true]:bg-accent/40",
                          )}
                        >
                          <div className="flex min-w-0 flex-1 items-start gap-3">
                            <div
                              className={cn(
                                "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border",
                                selected
                                  ? "border-primary bg-primary text-primary-foreground"
                                  : "border-border bg-background",
                              )}
                            >
                              {selected ? (
                                <CheckIcon className="size-3" />
                              ) : null}
                            </div>

                            <div className="min-w-0 flex-1 space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="truncate text-sm font-semibold">
                                  {base.knowledgeBaseName}
                                </div>
                                {base.attachedToThread ? (
                                  <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                                    <BookOpenTextIcon className="size-3" />
                                    {t.knowledge.attached}
                                  </span>
                                ) : null}
                              </div>
                              <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
                                <span className="inline-flex items-center gap-1">
                                  <FolderIcon className="size-3" />
                                  {base.ownerName}
                                </span>
                                <span>/</span>
                                <span>{t.knowledge.documentCount(base.documentCount)}</span>
                                {base.fileKinds.length > 0 ? (
                                  <>
                                    <span>/</span>
                                    <span>{base.fileKinds.join(" · ")}</span>
                                  </>
                                ) : null}
                              </div>
                              {base.description ? (
                                <div className="text-muted-foreground line-clamp-2 text-xs leading-5">
                                  {base.description}
                                </div>
                              ) : documentSummary.label ? (
                                <div className="text-muted-foreground line-clamp-2 text-xs leading-5">
                                  {documentSummary.label}
                                  {documentSummary.remainingCount > 0
                                    ? ` +${documentSummary.remainingCount}`
                                    : ""}
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

            <DialogFooter className="border-border flex shrink-0 items-center justify-between border-t px-6 py-4">
              <div className="text-muted-foreground flex items-center gap-2 text-xs">
                <BookOpenTextIcon className="size-4" />
                <span>
                  {t.knowledge.selector.selectedCount(draftBaseIds.length)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  className="rounded-md"
                  onClick={() => setOpen(false)}
                >
                  {t.common.cancel}
                </Button>
                <Button
                  onClick={handleApply}
                  disabled={applying}
                  className="rounded-md"
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
