import { useEffect, useMemo, useState } from "react";
import { Cpu, Pencil, Plus, Trash2 } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import { formatDate, maskString } from "@/lib/format";
import type { AdminModel } from "@/types";
import { toast } from "sonner";

import {
  buildExistingModelPayload,
  getModelApiKey,
  getModelCapabilityBadges,
  getRuntimeModelLabel,
} from "./model-config";
import { ModelForm } from "./model-form";
import { NewAPIModelSync } from "./newapi-model-sync";

interface ModelsTableProps {
  models: AdminModel[] | null;
  isLoading: boolean;
  page: number;
  pageSize: number;
  search: string;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onRefetch: () => void;
  onSearchChange: (search: string) => void;
}

export function ModelsTable({
  models,
  isLoading,
  page,
  pageSize,
  search,
  total,
  onPageChange,
  onPageSizeChange,
  onRefetch,
  onSearchChange,
}: ModelsTableProps) {
  const [editModel, setEditModel] = useState<AdminModel | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AdminModel | null>(null);
  const [deleteSelectedOpen, setDeleteSelectedOpen] = useState(false);
  const [selectedNames, setSelectedNames] = useState<string[]>([]);
  const [isDeletingSelected, setIsDeletingSelected] = useState(false);

  const visibleModels = models?.length ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const pageStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const pageEnd = Math.min(page * pageSize, total);
  const selectedNameSet = useMemo(
    () => new Set(selectedNames),
    [selectedNames],
  );
  const allPageModelsSelected =
    visibleModels > 0 &&
    models?.every((model) => selectedNameSet.has(model.name)) === true;

  useEffect(() => {
    const currentPageNames = new Set(models?.map((model) => model.name) ?? []);
    // Bulk delete is scoped to the visible page, so hidden selections are
    // dropped when search or pagination changes.
    setSelectedNames((current) =>
      current.filter((name) => currentPageNames.has(name)),
    );
  }, [models]);

  function openCreateForm() {
    setEditModel(null);
    setFormOpen(true);
  }

  function openEditForm(model: AdminModel) {
    setEditModel(model);
    setFormOpen(true);
  }

  async function handleDelete() {
    if (!deleteTarget) {
      return;
    }

    try {
      await api(`/api/admin/models/${encodeURIComponent(deleteTarget.name)}`, {
        method: "DELETE",
      });
      toast.success(t("Model deleted"));
      setDeleteTarget(null);
      if (visibleModels <= 1 && page > 1) {
        onPageChange(page - 1);
      } else {
        onRefetch();
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("Failed to delete model"),
      );
    }
  }

  function toggleModelSelection(name: string, selected: boolean) {
    setSelectedNames((current) => {
      if (!selected) {
        return current.filter((item) => item !== name);
      }
      return Array.from(new Set([...current, name]));
    });
  }

  function togglePageSelection(selected: boolean) {
    const pageNames = models?.map((model) => model.name) ?? [];
    setSelectedNames(selected ? pageNames : []);
  }

  async function handleDeleteSelected() {
    if (!selectedNames.length) {
      return;
    }

    setIsDeletingSelected(true);
    try {
      const results = await Promise.allSettled(
        selectedNames.map((name) =>
          api(`/api/admin/models/${encodeURIComponent(name)}`, {
            method: "DELETE",
          }),
        ),
      );
      const failed = results.filter((result) => result.status === "rejected");
      const deleted = results.length - failed.length;

      if (deleted > 0) {
        toast.success(t("Deleted {count} models", { count: deleted }));
      }
      if (failed.length > 0) {
        toast.error(
          t("Deleted {deleted} models, failed {failed}", {
            deleted,
            failed: failed.length,
          }),
        );
      }
      setSelectedNames([]);
      setDeleteSelectedOpen(false);
      if (deleted >= visibleModels && page > 1) {
        onPageChange(page - 1);
      } else {
        onRefetch();
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("Failed to delete selected models"),
      );
    } finally {
      setIsDeletingSelected(false);
    }
  }

  async function handleToggleEnabled(model: AdminModel) {
    try {
      await api(`/api/admin/models/${encodeURIComponent(model.name)}`, {
        method: "PUT",
        body: buildExistingModelPayload(model, { enabled: !model.enabled }),
      });
      toast.success(
        !model.enabled ? t("Model enabled") : t("Model disabled"),
      );
      onRefetch();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("Failed to update model"),
      );
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-card/70 p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">{t("Runtime inventory")}</p>
            <p className="text-sm text-muted-foreground">
              {total > 0
                ? t("Showing {start}-{end} of {total} models", {
                    start: pageStart,
                    end: pageEnd,
                    total,
                  })
                : t("{total} models available", { total })}
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Input
              className="w-full sm:w-[26rem]"
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder={t("Search by name, provider, or runtime model...")}
              value={search}
            />
            {selectedNames.length ? (
              <>
                <span className="whitespace-nowrap text-sm text-muted-foreground">
                  {t("{count} models selected", { count: selectedNames.length })}
                </span>
                <Button
                  className="shrink-0"
                  type="button"
                  variant="ghost"
                  onClick={() => setSelectedNames([])}
                >
                  {t("Clear selection")}
                </Button>
                <Button
                  className="shrink-0"
                  type="button"
                  variant="destructive"
                  onClick={() => setDeleteSelectedOpen(true)}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  {t("Delete selected models")}
                </Button>
              </>
            ) : null}
            <NewAPIModelSync onSuccess={onRefetch} />
            <Button className="shrink-0" onClick={openCreateForm}>
              <Plus className="mr-2 h-4 w-4" />
              {t("Add Model")}
            </Button>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-12 w-full" />
          ))}
        </div>
      ) : !models?.length ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <Cpu className="mb-2 h-12 w-12 opacity-40" />
          <p>{t("No models found")}</p>
        </div>
      ) : (
        <div className="rounded-xl border bg-card/70 shadow-sm">
          {/* Fixed column widths keep the admin table readable when capability badges
              and model names get long, instead of letting a single noisy column
              push status/actions out of alignment. */}
          <Table className="table-fixed min-w-[980px]">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[3rem]">
                  <input
                    aria-label={t("Select all models on this page")}
                    checked={allPageModelsSelected}
                    className="h-4 w-4 rounded border-border accent-primary"
                    type="checkbox"
                    onChange={(event) => togglePageSelection(event.target.checked)}
                  />
                </TableHead>
                <TableHead className="w-[13rem]">{t("Name")}</TableHead>
                <TableHead className="w-[6rem]">{t("Provider")}</TableHead>
                <TableHead className="w-[9rem]">{t("Runtime Model")}</TableHead>
                <TableHead className="w-[14rem]">{t("Capabilities")}</TableHead>
                <TableHead className="w-[7rem]">{t("API Key")}</TableHead>
                <TableHead className="w-[8rem]">{t("Status")}</TableHead>
                <TableHead className="w-[8rem]">{t("Created")}</TableHead>
                <TableHead className="w-[4rem] text-right">{t("Actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {models.map((model) => (
                <ModelRow
                  key={model.name}
                  model={model}
                  selected={selectedNameSet.has(model.name)}
                  onDelete={setDeleteTarget}
                  onEdit={openEditForm}
                  onSelectionChange={toggleModelSelection}
                  onToggleEnabled={handleToggleEnabled}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {total > 0 ? (
        <div className="flex flex-col gap-3 rounded-xl border bg-card/70 px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-muted-foreground">
            {t("Showing {start}-{end} of {total} models", {
              start: pageStart,
              end: pageEnd,
              total,
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {t("Rows per page")}
            </span>
            <Select
              value={String(pageSize)}
              onValueChange={(value) => onPageSizeChange(Number(value))}
            >
              <SelectTrigger className="w-[88px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[5, 10, 20, 50].map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              disabled={page <= 1}
              type="button"
              variant="outline"
              onClick={() => onPageChange(Math.max(1, page - 1))}
            >
              {t("Prev")}
            </Button>
            <Button
              disabled={page >= pageCount}
              type="button"
              variant="outline"
              onClick={() => onPageChange(Math.min(pageCount, page + 1))}
            >
              {t("Next")}
            </Button>
          </div>
        </div>
      ) : null}

      <ModelForm
        editModel={editModel}
        onOpenChange={setFormOpen}
        onSuccess={onRefetch}
        open={formOpen}
      />

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Delete Model")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "Are you sure you want to delete {name}? This will remove it from runtime selection immediately.",
                {
                  name: deleteTarget?.display_name || deleteTarget?.name || "",
                },
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
            >
              {t("Delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={deleteSelectedOpen}
        onOpenChange={(open) => !open && setDeleteSelectedOpen(false)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Delete Selected Models")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "Are you sure you want to delete {count} models? This will remove them from runtime selection immediately.",
                { count: selectedNames.length },
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingSelected}>
              {t("Cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isDeletingSelected}
              onClick={(event) => {
                event.preventDefault();
                void handleDeleteSelected();
              }}
            >
              {isDeletingSelected ? t("Deleting...") : t("Delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ModelRow({
  model,
  selected,
  onEdit,
  onDelete,
  onSelectionChange,
  onToggleEnabled,
}: {
  model: AdminModel;
  selected: boolean;
  onEdit: (model: AdminModel) => void;
  onDelete: (model: AdminModel) => void;
  onSelectionChange: (name: string, selected: boolean) => void;
  onToggleEnabled: (model: AdminModel) => void;
}) {
  const capabilities = getModelCapabilityBadges(model);

  return (
    <TableRow>
      <TableCell className="align-top">
        <input
          aria-label={t("Select model")}
          checked={selected}
          className="h-4 w-4 rounded border-border accent-primary"
          type="checkbox"
          onChange={(event) =>
            onSelectionChange(model.name, event.target.checked)
          }
        />
      </TableCell>
      <TableCell className="pr-3">
        <div className="space-y-1">
          <div className="break-all font-mono text-sm leading-5">{model.name}</div>
          <div className="line-clamp-1 text-xs text-muted-foreground">
            {model.display_name || model.name}
          </div>
        </div>
      </TableCell>
      <TableCell className="pr-3 align-top">
        <Badge variant="outline">{model.provider}</Badge>
      </TableCell>
      <TableCell className="pr-3 text-sm text-muted-foreground">
        {getRuntimeModelLabel(model)}
      </TableCell>
      <TableCell className="pr-3">
        <div className="flex max-w-[13rem] flex-wrap gap-1">
          {capabilities.length ? (
            capabilities.map((capability) => (
              <Badge key={capability} variant="secondary">
                {capability}
              </Badge>
            ))
          ) : (
            <span className="text-sm text-muted-foreground">{t("Basic")}</span>
          )}
        </div>
      </TableCell>
      <TableCell className="font-mono text-xs text-muted-foreground">
        {maskString(getModelApiKey(model))}
      </TableCell>
      <TableCell className="pr-3">
        <div className="flex items-center gap-2">
          <Switch
            checked={model.enabled}
            onCheckedChange={() => onToggleEnabled(model)}
          />
          <span className="text-sm text-muted-foreground">
            {model.enabled ? t("Enabled") : t("Disabled")}
          </span>
        </div>
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {formatDate(model.created_at)}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon" variant="ghost" onClick={() => onEdit(model)}>
                <Pencil className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("Edit model")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => onDelete(model)}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("Delete model")}</TooltipContent>
          </Tooltip>
        </div>
      </TableCell>
    </TableRow>
  );
}
