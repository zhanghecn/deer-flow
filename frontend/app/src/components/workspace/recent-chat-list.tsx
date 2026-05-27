import { MoreHorizontal, Pencil, Share2, Trash2 } from "lucide-react";
import { memo, useCallback, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
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
  SidebarMenuItem,
  sidebarMenuActionClassName,
  sidebarMenuButtonClassName,
} from "@/components/ui/sidebar";
import { DEMO_SHARE_BASE_URL } from "@/core/config/site";
import { useI18n } from "@/core/i18n/hooks";
import {
  useDeleteThread,
  useRenameThread,
  useThreads,
} from "@/core/threads/query-hooks";
import type { AgentThread } from "@/core/threads/types";
import {
  pathAfterThreadDeletion,
  pathOfThread,
  titleOfThread,
} from "@/core/threads/utils";
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
      {/* Recent chats repaint after query refreshes; rendering the link directly
          avoids a high-volume Radix Slot ref chain on every thread row. */}
      <Link
        data-slot="sidebar-menu-button"
        data-sidebar="menu-button"
        data-size="default"
        data-active={isActive}
        className={sidebarMenuButtonClassName({
          className:
            "text-muted-foreground h-9 min-w-0 truncate text-sm leading-5",
        })}
        to={href}
        onMouseEnter={() => onPrefetch(href)}
        onFocus={() => onPrefetch(href)}
      >
        {title}
      </Link>

      {env.VITE_STATIC_WEBSITE_ONLY !== "true" && (
        <DropdownMenu>
          {/* Keep the trigger as a real button instead of wrapping
              SidebarMenuAction with asChild; this preserves menu behavior while
              reducing callback-ref churn in the sidebar list. */}
          <DropdownMenuTrigger
            data-slot="sidebar-menu-action"
            data-sidebar="menu-action"
            className={sidebarMenuActionClassName({
              showOnHover: true,
              className: "bg-background/65 hover:bg-background h-7 w-7",
            })}
            type="button"
          >
            <MoreHorizontal className="size-3.5" />
            <span className="sr-only">{moreLabel}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-44 rounded-lg"
            side="right"
            align="start"
          >
            <DropdownMenuItem onSelect={() => onRenameClick(threadId, title)}>
              <Pencil className="text-muted-foreground size-3.5" />
              <span className="text-sm">{renameLabel}</span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onShare}>
              <Share2 className="text-muted-foreground size-3.5" />
              <span className="text-sm">{shareLabel}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void onDelete(threadId)}>
              <Trash2 className="text-muted-foreground size-3.5" />
              <span className="text-sm">{deleteLabel}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </SidebarMenuItem>
  );
});

export function RecentChatList() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const pathname = useLocation().pathname;
  const { thread_id: threadIdFromPath } = useParams<{ thread_id: string }>();
  const { data } = useThreads();
  const threads = data?.items ?? [];
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
          void navigate(pathAfterThreadDeletion(threads, threadId));
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
      }
    },
    [deleteThread, navigate, threadIdFromPath, threads],
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
      const isLocalhost =
        window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1";
      const baseUrl = isLocalhost
        ? DEMO_SHARE_BASE_URL
        : window.location.origin;
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

  const handlePrefetch = useCallback((_href: string) => {
    // No-op: react-router-dom does not support programmatic prefetch
  }, []);

  if (threadItems.length === 0) {
    return null;
  }

  return (
    <>
      <SidebarGroup className="flex min-h-0 flex-1 flex-col px-2 pt-0">
        <SidebarGroupLabel className="text-muted-foreground/60 text-[11px] font-medium tracking-wider uppercase">
          {env.VITE_STATIC_WEBSITE_ONLY !== "true"
            ? t.sidebar.recentChats
            : t.sidebar.demoChats}
        </SidebarGroupLabel>
        <SidebarGroupContent className="min-h-0 flex-1 overflow-hidden group-data-[collapsible=icon]:pointer-events-none group-data-[collapsible=icon]:-mt-8 group-data-[collapsible=icon]:opacity-0">
          <ScrollArea className="h-full pr-1">
            <SidebarMenu className="gap-0.5">
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
        <DialogContent className="gap-4 sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="text-base">{t.common.rename}</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              placeholder={t.common.rename}
              className="h-9"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleRenameSubmit();
                }
              }}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRenameDialogOpen(false)}
            >
              {t.common.cancel}
            </Button>
            <Button size="sm" onClick={handleRenameSubmit}>
              {t.common.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
