import { useState } from "react";
import { Key, Pencil, Plus, Trash2 } from "lucide-react";
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
import { LLMKeyForm } from "./llm-key-form";
import { api } from "@/lib/api";
import type { LLMProviderKey } from "@/types";
import { toast } from "sonner";

const PROVIDER_COLORS: Record<string, string> = {
  openai: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  anthropic: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  deepseek: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  google: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  openrouter: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
};

interface LLMKeysTableProps {
  keys: LLMProviderKey[] | null;
  isLoading: boolean;
  onRefetch: () => void;
}

export function LLMKeysTable({ keys, isLoading, onRefetch }: LLMKeysTableProps) {
  const [formOpen, setFormOpen] = useState(false);
  const [editKey, setEditKey] = useState<LLMProviderKey | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<LLMProviderKey | null>(null);

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await api(`/api/admin/llm-keys/${deleteTarget.id}`, { method: "DELETE" });
      toast.success("Key deleted");
      setDeleteTarget(null);
      onRefetch();
    } catch {
      toast.error("Failed to delete key");
    }
  }

  async function handleToggleActive(key: LLMProviderKey) {
    try {
      await api(`/api/admin/llm-keys/${key.id}`, {
        method: "PUT",
        body: {
          provider_name: key.provider_name,
          display_name: key.display_name,
          api_key: key.api_key,
          base_url: key.base_url,
          is_active: !key.is_active,
        },
      });
      onRefetch();
    } catch {
      toast.error("Failed to toggle status");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => { setEditKey(null); setFormOpen(true); }}>
          <Plus className="mr-2 h-4 w-4" />
          Add Key
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : !keys?.length ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <Key className="h-12 w-12 mb-2 opacity-40" />
          <p>No provider keys configured</p>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Provider</TableHead>
                <TableHead>Display Name</TableHead>
                <TableHead>API Key</TableHead>
                <TableHead>Base URL</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((key) => (
                <TableRow key={key.id}>
                  <TableCell>
                    <Badge
                      className={
                        PROVIDER_COLORS[key.provider_name] ??
                        "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200"
                      }
                    >
                      {key.provider_name}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-medium">
                    {key.display_name}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {key.api_key}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                    {key.base_url || "-"}
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={key.is_active}
                      onCheckedChange={() => handleToggleActive(key)}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              setEditKey(key);
                              setFormOpen(true);
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Edit</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setDeleteTarget(key)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Delete</TooltipContent>
                      </Tooltip>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <LLMKeyForm
        open={formOpen}
        onOpenChange={setFormOpen}
        editKey={editKey}
        onSuccess={onRefetch}
      />

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Provider Key</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete{" "}
              <strong>{deleteTarget?.display_name}</strong>? This action cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
