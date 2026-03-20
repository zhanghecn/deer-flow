"use client";

import { MoreHorizontal, Pencil, Share2, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { memo, useCallback, useMemo, useState } from "react";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useI18n } from "@/core/i18n/hooks";
import {
  useDeleteThread,
  useRenameThread,
  useThreads,
} from "@/core/threads/query-hooks";
import {
  pathAfterThreadDeletion,
  pathOfThread,
  titleOfThread,
} from "@/core/threads/utils";
import type { AgentThread } from "@/core/threads/types";
import { env } from "@/env";

type RecentChatItemProps = {
  href: string;
  isActive: boolean;
  threadId: string;
  title: string;
  moreLabel: string;
  renameLabel: string;
  shareLabel: string;
  deleteLabel: string;
  onPrefetch: (href: string) => void;
  onRenameClick: (threadId: string, currentTitle: string) => void;
  onShare: () => void;
  onDelete: (threadId: string) => Promise<void>;
};

const RecentChatItem = memo(function RecentChatItem({
  href,
  isActive,
  threadId,
  title,
  moreLabel,
  renameLabel,
  shareLabel,
  deleteLabel,
  onPrefetch,
  onRenameClick,
  onShare,
  onDelete,
}: RecentChatItemProps) {
  return (
    <SidebarMenuItem className="group/side-menu-item">
      <SidebarMenuButton isActive={isActive} asChild className="min-w-0">
        <Link
          className="text-muted-foreground block w-full truncate"
          href={href}
          prefetch={false}
          onMouseEnter={() => onPrefetch(href)}
          onFocus={() => onPrefetch(href)}
        >
          {title}
        </Link>
      </SidebarMenuButton>

      {env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY !== "true" && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuAction
              showOnHover
              className="bg-background/65 hover:bg-background"
            >
              <MoreHorizontal />
              <span className="sr-only">{moreLabel}</span>
            </SidebarMenuAction>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-48 rounded-lg"
            side="right"
            align="start"
          >
            <DropdownMenuItem onSelect={() => onRenameClick(threadId, title)}>
              <Pencil className="text-muted-foreground" />
              <span>{renameLabel}</span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onShare}>
              <Share2 className="text-muted-foreground" />
              <span>{shareLabel}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void onDelete(threadId)}>
              <Trash2 className="text-muted-foreground" />
              <span>{deleteLabel}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </SidebarMenuItem>
  );
});

export function RecentChatList() {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const { thread_id: threadIdFromPath } = useParams<{ thread_id: string }>();
  const { data: threads = [] } = useThreads();
  const { mutateAsync: deleteThread } = useDeleteThread();
  const { mutate: renameThread } = useRenameThread();

  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameThreadId, setRenameThreadId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const threadItems = useMemo(
    () =>
      threads.map((thread) => {
        const href = pathOfThread(thread);
        return {
          thread,
          threadId: thread.thread_id,
          title: titleOfThread(thread),
          href,
          isActive:
            pathname === href.split("?", 1)[0] &&
            thread.thread_id === threadIdFromPath,
        };
      }),
    [pathname, threadIdFromPath, threads],
  );

  const handleDelete = useCallback(
    async (threadId: string) => {
      try {
        await deleteThread({ threadId });
        if (threadId === threadIdFromPath) {
          void router.push(pathAfterThreadDeletion(threads, threadId));
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
      }
    },
    [deleteThread, router, threadIdFromPath, threads],
  );

  const handleRenameClick = useCallback(
    (threadId: string, currentTitle: string) => {
      setRenameThreadId(threadId);
      setRenameValue(currentTitle);
      setRenameDialogOpen(true);
    },
    [],
  );

  const handleRenameSubmit = useCallback(() => {
    if (renameThreadId && renameValue.trim()) {
      renameThread({ threadId: renameThreadId, title: renameValue.trim() });
      setRenameDialogOpen(false);
      setRenameThreadId(null);
      setRenameValue("");
    }
  }, [renameThread, renameThreadId, renameValue]);

  const handleShare = useCallback(
    async (thread: AgentThread) => {
      const VERCEL_URL = "https://openagents-v2.vercel.app";
      const isLocalhost =
        window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1";
      const baseUrl = isLocalhost ? VERCEL_URL : window.location.origin;
      const shareUrl = `${baseUrl}${pathOfThread(thread)}`;
      try {
        await navigator.clipboard.writeText(shareUrl);
        toast.success(t.clipboard.linkCopied);
      } catch {
        toast.error(t.clipboard.failedToCopyToClipboard);
      }
    },
    [t],
  );

  const handlePrefetch = useCallback(
    (href: string) => {
      void router.prefetch(href);
    },
    [router],
  );

  if (threadItems.length === 0) {
    return null;
  }

  return (
    <>
      <SidebarGroup className="flex min-h-0 flex-1 flex-col pt-0">
        <SidebarGroupLabel>
          {env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY !== "true"
            ? t.sidebar.recentChats
            : t.sidebar.demoChats}
        </SidebarGroupLabel>
        <SidebarGroupContent className="min-h-0 flex-1 overflow-hidden group-data-[collapsible=icon]:pointer-events-none group-data-[collapsible=icon]:-mt-8 group-data-[collapsible=icon]:opacity-0">
          <ScrollArea className="h-full pr-1">
            <SidebarMenu className="gap-1">
              {threadItems.map((thread) => (
                <RecentChatItem
                  key={thread.threadId}
                  href={thread.href}
                  isActive={thread.isActive}
                  threadId={thread.threadId}
                  title={thread.title}
                  moreLabel={t.common.more}
                  renameLabel={t.common.rename}
                  shareLabel={t.common.share}
                  deleteLabel={t.common.delete}
                  onPrefetch={handlePrefetch}
                  onRenameClick={handleRenameClick}
                  onShare={() => handleShare(thread.thread)}
                  onDelete={handleDelete}
                />
              ))}
            </SidebarMenu>
          </ScrollArea>
        </SidebarGroupContent>
      </SidebarGroup>

      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>{t.common.rename}</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              placeholder={t.common.rename}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleRenameSubmit();
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRenameDialogOpen(false)}
            >
              {t.common.cancel}
            </Button>
            <Button onClick={handleRenameSubmit}>{t.common.save}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </>
  );
}
