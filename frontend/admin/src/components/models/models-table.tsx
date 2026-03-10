import { useMemo, useState } from "react";
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
import { api } from "@/lib/api";
import { formatDate, maskString } from "@/lib/format";
import type { AdminModel } from "@/types";
import { toast } from "sonner";

import {
  buildExistingModelPayload,
  filterModels,
  getModelApiKey,
  getModelCapabilityBadges,
  getRuntimeModelLabel,
} from "./model-config";
import { ModelForm } from "./model-form";

interface ModelsTableProps {
  models: AdminModel[] | null;
  isLoading: boolean;
  onRefetch: () => void;
}

export function ModelsTable({
  models,
  isLoading,
  onRefetch,
}: ModelsTableProps) {
  const [search, setSearch] = useState("");
  const [editModel, setEditModel] = useState<AdminModel | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AdminModel | null>(null);

  const filteredModels = useMemo(
    () => filterModels(models, search),
    [models, search],
  );

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
      toast.success("Model deleted");
      setDeleteTarget(null);
      onRefetch();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete model",
      );
    }
  }

  async function handleToggleEnabled(model: AdminModel) {
    try {
      await api(`/api/admin/models/${encodeURIComponent(model.name)}`, {
        method: "PUT",
        body: buildExistingModelPayload(model, { enabled: !model.enabled }),
      });
      toast.success(`Model ${!model.enabled ? "enabled" : "disabled"}`);
      onRefetch();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to update model",
      );
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Input
          className="max-w-sm"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by name, provider, or runtime model..."
          value={search}
        />
        <Button onClick={openCreateForm}>
          <Plus className="mr-2 h-4 w-4" />
          Add Model
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-12 w-full" />
          ))}
        </div>
      ) : !filteredModels?.length ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <Cpu className="mb-2 h-12 w-12 opacity-40" />
          <p>No models found</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Runtime Model</TableHead>
                <TableHead>Capabilities</TableHead>
                <TableHead>API Key</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredModels.map((model) => (
                <ModelRow
                  key={model.name}
                  model={model}
                  onDelete={setDeleteTarget}
                  onEdit={openEditForm}
                  onToggleEnabled={handleToggleEnabled}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

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
            <AlertDialogTitle>Delete Model</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete{" "}
              <strong>{deleteTarget?.display_name || deleteTarget?.name}</strong>
              ? This will remove it from runtime selection immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ModelRow({
  model,
  onEdit,
  onDelete,
  onToggleEnabled,
}: {
  model: AdminModel;
  onEdit: (model: AdminModel) => void;
  onDelete: (model: AdminModel) => void;
  onToggleEnabled: (model: AdminModel) => void;
}) {
  const capabilities = getModelCapabilityBadges(model);

  return (
    <TableRow>
      <TableCell>
        <div className="space-y-1">
          <div className="font-mono text-sm">{model.name}</div>
          <div className="text-xs text-muted-foreground">
            {model.display_name || model.name}
          </div>
        </div>
      </TableCell>
      <TableCell>
        <Badge variant="outline">{model.provider}</Badge>
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {getRuntimeModelLabel(model)}
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1">
          {capabilities.length ? (
            capabilities.map((capability) => (
              <Badge key={capability} variant="secondary">
                {capability}
              </Badge>
            ))
          ) : (
            <span className="text-sm text-muted-foreground">Basic</span>
          )}
        </div>
      </TableCell>
      <TableCell className="font-mono text-xs text-muted-foreground">
        {maskString(getModelApiKey(model))}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <Switch
            checked={model.enabled}
            onCheckedChange={() => onToggleEnabled(model)}
          />
          <span className="text-sm text-muted-foreground">
            {model.enabled ? "Enabled" : "Disabled"}
          </span>
        </div>
      </TableCell>
      <TableCell className="text-muted-foreground">
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
            <TooltipContent>Edit model</TooltipContent>
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
            <TooltipContent>Delete model</TooltipContent>
          </Tooltip>
        </div>
      </TableCell>
    </TableRow>
  );
}
