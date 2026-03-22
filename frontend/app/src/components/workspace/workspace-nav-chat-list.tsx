"use client";

import { BotIcon, MessagesSquare, Trash2 } from "lucide-react";
import Link from "next/link";
import {
  useParams,
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useI18n } from "@/core/i18n/hooks";
import { useClearThreads, useThreads } from "@/core/threads/query-hooks";

export function WorkspaceNavChatList() {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { thread_id: threadIdFromPath } = useParams<{ thread_id?: string }>();
  const { data: threads = [] } = useThreads();
  const clearThreads = useClearThreads();
  const [clearDialogOpen, setClearDialogOpen] = useState(false);

  const hasChats = useMemo(
    () =>
      (threadIdFromPath != null && threadIdFromPath !== "new") ||
      threads.length > 0,
    [threadIdFromPath, threads.length],
  );

  const nextPath = useMemo(() => {
    if (threadIdFromPath && threadIdFromPath !== "new" && pathname.includes("/chats/")) {
      const basePath = pathname.replace(/\/chats\/[^/]+$/, "/chats/new");
      const params = new URLSearchParams(searchParams.toString());
      params.delete("pending_run");
      const query = params.toString();
      return query ? `${basePath}?${query}` : basePath;
    }

    return "/workspace/chats/new";
  }, [pathname, searchParams, threadIdFromPath]);
  const isChatsPage =
    pathname === "/workspace/chats" ||
    pathname.startsWith("/workspace/chats/") ||
    pathname.includes("/chats/");
  const isAgentsPage =
    pathname === "/workspace/agents" || pathname === "/workspace/agents/new";

  const handleClearAll = useCallback(async () => {
    try {
      await clearThreads.mutateAsync();
      setClearDialogOpen(false);
      toast.success(t.chats.clearAllSuccess);
      if (threadIdFromPath && threadIdFromPath !== "new") {
        void router.push(nextPath);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }, [
    clearThreads,
    nextPath,
    router,
    t.chats.clearAllSuccess,
    threadIdFromPath,
  ]);

  return (
    <>
      <SidebarGroup className="pt-1">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton isActive={isChatsPage} asChild>
              <Link
                className="text-muted-foreground"
                href="/workspace/chats"
                prefetch={false}
              >
                <MessagesSquare />
                <span>{t.sidebar.chats}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton isActive={isAgentsPage} asChild>
              <Link
                className="text-muted-foreground"
                href="/workspace/agents"
                prefetch={false}
              >
                <BotIcon />
                <span>{t.sidebar.agents}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          {hasChats ? (
            <SidebarMenuItem>
              <SidebarMenuButton
                className="text-destructive hover:text-destructive"
                onClick={() => setClearDialogOpen(true)}
              >
                <Trash2 />
                <span>{t.chats.clearAll}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ) : null}
        </SidebarMenu>
      </SidebarGroup>

      <Dialog open={clearDialogOpen} onOpenChange={setClearDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>{t.chats.clearAll}</DialogTitle>
          </DialogHeader>
          <div className="text-muted-foreground py-2 text-sm">
            {t.chats.clearAllConfirm}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setClearDialogOpen(false)}
              disabled={clearThreads.isPending}
            >
              {t.common.cancel}
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleClearAll()}
              disabled={clearThreads.isPending}
            >
              {clearThreads.isPending ? t.common.loading : t.common.clearAll}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
