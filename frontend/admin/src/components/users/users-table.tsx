import { useState } from "react";
import { Shield, Trash2, User } from "lucide-react";
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
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
import { formatDate } from "@/lib/format";
import type { AdminUser } from "@/types";
import { toast } from "sonner";

interface UsersTableProps {
  users: AdminUser[] | null;
  isLoading: boolean;
  onRefetch: () => void;
}

export function UsersTable({ users, isLoading, onRefetch }: UsersTableProps) {
  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);

  const filtered = users?.filter(
    (u) =>
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase()),
  );

  async function handleToggleRole(user: AdminUser) {
    const newRole = user.role === "admin" ? "user" : "admin";
    try {
      await api(`/api/admin/users/${user.id}/role`, {
        method: "PATCH",
        body: { role: newRole },
      });
      toast.success(t("Role updated to {role}", { role: t(newRole) }));
      onRefetch();
    } catch {
      toast.error(t("Failed to update role"));
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await api(`/api/admin/users/${deleteTarget.id}`, { method: "DELETE" });
      toast.success(t("User deleted"));
      setDeleteTarget(null);
      onRefetch();
    } catch {
      toast.error(t("Failed to delete user"));
    }
  }

  return (
    <div className="space-y-4">
      <Input
        placeholder={t("Search by name or email...")}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : !filtered?.length ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <User className="h-12 w-12 mb-2 opacity-40" />
          <p>{t("No users found")}</p>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12" />
                <TableHead>{t("Name")}</TableHead>
                <TableHead>{t("Email")}</TableHead>
                <TableHead>{t("Role")}</TableHead>
                <TableHead>{t("Created")}</TableHead>
                <TableHead className="text-right">{t("Actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={user.avatar_url} />
                      <AvatarFallback>
                        {user.name.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                  </TableCell>
                  <TableCell className="font-medium">{user.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {user.email}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        user.role === "admin" ? "default" : "secondary"
                      }
                    >
                      {user.role === "admin" && (
                        <Shield className="mr-1 h-3 w-3" />
                      )}
                      {t(user.role)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(user.created_at)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleToggleRole(user)}
                          >
                            <Shield className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {user.role === "admin"
                            ? t("Demote to user")
                            : t("Promote to admin")}
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setDeleteTarget(user)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{t("Delete user")}</TooltipContent>
                      </Tooltip>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Delete User")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "Are you sure you want to delete {name} ({email})? This action cannot be undone.",
                {
                  name: deleteTarget?.name ?? "",
                  email: deleteTarget?.email ?? "",
                },
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("Delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
