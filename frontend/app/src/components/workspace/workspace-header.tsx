import { LaptopIcon, MessageSquarePlus } from "lucide-react";
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { buildWorkspaceAgentPath } from "@/core/agents";
import { APP_INITIALS, APP_NAME } from "@/core/config/site";
import { useI18n } from "@/core/i18n/hooks";
import { useOpenRuntimeWorkspace } from "@/core/runtime-workspaces/hooks";
import { useThreadRuntime } from "@/core/threads/query-hooks";
import { env } from "@/env";
import { cn } from "@/lib/utils";

export function WorkspaceHeader({ className }: { className?: string }) {
  const { t } = useI18n();
  const { state } = useSidebar();
  const pathname = useLocation().pathname;
  const params = useParams<{ agent_name?: string; thread_id?: string }>();
  const [searchParams] = useSearchParams();
  const openRuntimeWorkspace = useOpenRuntimeWorkspace();
  const threadId =
    params.thread_id && params.thread_id !== "new" ? params.thread_id : null;
  const threadRuntime = useThreadRuntime(threadId);
  const newChatPath = buildWorkspaceAgentPath({
    agentName: params.agent_name ?? searchParams.get("agent_name") ?? "lead_agent",
    agentStatus: (searchParams.get("agent_status") as "dev" | "prod" | null) ?? "dev",
    executionBackend:
      searchParams.get("execution_backend") === "remote" ? "remote" : undefined,
    remoteSessionId: searchParams.get("remote_session_id") ?? undefined,
  });
  const canOpenRuntimeWorkspace = Boolean(
    threadId &&
      threadRuntime.data &&
      threadRuntime.data.execution_backend !== "remote",
  );

  async function handleOpenRuntimeWorkspace() {
    if (!threadId) {
      return;
    }
    const popup = window.open("about:blank", "_blank");
    if (popup) {
      popup.document.title = t.sidebar.runtimeWorkspace;
    }
    try {
      const session = await openRuntimeWorkspace.mutateAsync({ threadId });
      if (popup) {
        popup.opener = null;
        popup.location.replace(session.relative_url);
        return;
      }
      window.open(session.relative_url, "_blank", "noopener,noreferrer");
    } catch (error) {
      popup?.close();
      toast.error(
        error instanceof Error ? error.message : t.sidebar.runtimeWorkspace,
      );
    }
  }

  return (
    <>
      <div
        className={cn(
          "group/workspace-header flex h-12 flex-col justify-center dark:glass",
          // Light mode: clean flat header, no glass
          className,
        )}
      >
        {state === "collapsed" ? (
          <div className="group-has-data-[collapsible=icon]/sidebar-wrapper:-translate-y flex w-full cursor-pointer items-center justify-center">
            <div className="block pt-1 font-serif text-foreground dark:text-primary group-hover/workspace-header:hidden">
              {APP_INITIALS}
            </div>
            <SidebarTrigger className="hidden pl-2 group-hover/workspace-header:block" />
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            {env.VITE_STATIC_WEBSITE_ONLY === "true" ? (
              <Link to="/" className="ml-2 font-serif text-foreground dark:text-primary dark:text-glow">
                {APP_NAME}
              </Link>
            ) : (
              <div className="ml-2 cursor-default font-serif text-foreground dark:text-primary dark:text-glow">
                {APP_NAME}
              </div>
            )}
            <SidebarTrigger />
          </div>
        )}
      </div>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={pathname.endsWith("/chats/new")}
            asChild
          >
            <Link className="text-muted-foreground" to={newChatPath}>
              <MessageSquarePlus size={16} />
              <span>{t.sidebar.newChat}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        {canOpenRuntimeWorkspace ? (
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip={t.sidebar.runtimeWorkspace}
              disabled={openRuntimeWorkspace.isPending}
              onClick={() => {
                void handleOpenRuntimeWorkspace();
              }}
            >
              <LaptopIcon size={16} />
              <span>{t.sidebar.runtimeWorkspace}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ) : null}
      </SidebarMenu>
    </>
  );
}
