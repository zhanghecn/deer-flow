import { useEffect, useState } from "react";
import { KeyRound, Shield, Trash2, User } from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { formatDate, formatDateTime } from "@/lib/format";
import type { AdminAPIToken, AdminUser } from "@/types";
import { toast } from "sonner";

interface UsersTableProps {
  users: AdminUser[] | null;
  isLoading: boolean;
  onRefetch: () => void;
}

export function UsersTable({ users, isLoading, onRefetch }: UsersTableProps) {
  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);
  const [tokenTarget, setTokenTarget] = useState<AdminUser | null>(null);
  const [tokens, setTokens] = useState<AdminAPIToken[] | null>(null);
  const [tokensLoading, setTokensLoading] = useState(false);
  const [tokenName, setTokenName] = useState("");
  const [tokenAgent, setTokenAgent] = useState("");
  const [tokenSubmitting, setTokenSubmitting] = useState(false);

  const filtered = users?.filter(
    (u) =>
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase()),
  );

  function resetTokenDialog() {
    setTokenTarget(null);
    setTokens(null);
    setTokenName("");
    setTokenAgent("");
    setTokenSubmitting(false);
  }

  function markTokenRevoked(tokenID: string) {
    setTokens((current) =>
      (current ?? []).map((token) =>
        token.id === tokenID
          ? {
              ...token,
              status: "revoked",
              revoked_at: token.revoked_at ?? new Date().toISOString(),
            }
          : token,
      ),
    );
  }

  useEffect(() => {
    if (!tokenTarget) {
      setTokens(null);
      return;
    }

    let cancelled = false;
    setTokensLoading(true);
    void api<AdminAPIToken[]>(`/api/admin/users/${tokenTarget.id}/tokens`)
      .then((items) => {
        if (!cancelled) {
          setTokens(items);
        }
      })
      .catch(() => {
        if (!cancelled) {
          toast.error(t("Failed to load API keys"));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setTokensLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [tokenTarget]);

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

  async function handleCreateToken() {
    if (!tokenTarget || !tokenName.trim() || !tokenAgent.trim()) return;

    setTokenSubmitting(true);
    try {
      const created = await api<AdminAPIToken>(
        `/api/admin/users/${tokenTarget.id}/tokens`,
        {
          method: "POST",
          body: {
            name: tokenName.trim(),
            allowed_agents: [tokenAgent.trim()],
          },
        },
      );
      setTokens((current) => [created, ...(current ?? [])]);
      setTokenName("");
      setTokenAgent("");
      toast.success(t("API key created"));
    } catch {
      toast.error(t("Failed to create API key"));
    } finally {
      setTokenSubmitting(false);
    }
  }

  async function handleRevokeToken(tokenID: string) {
    if (!tokenTarget) return;
    try {
      await api(`/api/admin/users/${tokenTarget.id}/tokens/${tokenID}`, {
        method: "DELETE",
      });
      markTokenRevoked(tokenID);
      toast.success(t("API key revoked"));
    } catch {
      toast.error(t("Failed to revoke API key"));
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
                            onClick={() => setTokenTarget(user)}
                          >
                            <KeyRound className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{t("Manage API keys")}</TooltipContent>
                      </Tooltip>
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

      <Dialog
        open={!!tokenTarget}
        onOpenChange={(open) => !open && resetTokenDialog()}
      >
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{t("Manage API keys")}</DialogTitle>
            <DialogDescription>
              {t("Manage API keys for {name}", {
                name: tokenTarget?.name ?? "",
              })}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
              <Input
                placeholder={t("API Key Name")}
                value={tokenName}
                onChange={(event) => setTokenName(event.target.value)}
              />
              <Input
                placeholder={t("Published Agent")}
                value={tokenAgent}
                onChange={(event) => setTokenAgent(event.target.value)}
              />
              <Button
                onClick={() => void handleCreateToken()}
                disabled={
                  tokenSubmitting || !tokenName.trim() || !tokenAgent.trim()
                }
              >
                {t("Create API Key")}
              </Button>
            </div>

            <p className="text-sm text-muted-foreground">
              {t(
                "API keys are scoped to exactly one published prod agent owned by this user.",
              )}
            </p>

            {tokensLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, index) => (
                  <Skeleton key={index} className="h-12 w-full" />
                ))}
              </div>
            ) : !tokens?.length ? (
              <div className="flex items-center justify-center rounded-md border py-10 text-muted-foreground">
                {t("No API keys found")}
              </div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("Name")}</TableHead>
                      <TableHead>{t("Agent")}</TableHead>
                      <TableHead>{t("Status")}</TableHead>
                      <TableHead>{t("Created")}</TableHead>
                      <TableHead>{t("Last Used")}</TableHead>
                      <TableHead>{t("API Key")}</TableHead>
                      <TableHead className="text-right">{t("Actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tokens.map((token) => (
                      <TableRow key={token.id}>
                        <TableCell className="font-medium">{token.name}</TableCell>
                        <TableCell>{token.allowed_agents[0] || "-"}</TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              token.status === "active" ? "default" : "secondary"
                            }
                          >
                            {t(token.status)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatDate(token.created_at)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatDateTime(token.last_used)}
                        </TableCell>
                        <TableCell className="max-w-[260px] break-all font-mono text-xs text-muted-foreground">
                          {token.token || "-"}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={token.status !== "active"}
                            onClick={() => void handleRevokeToken(token.id)}
                          >
                            {t("Revoke API key")}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
