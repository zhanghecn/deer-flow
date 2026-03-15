"use client";

import { MessageSquarePlus } from "lucide-react";
import Link from "next/link";
import { useParams, usePathname, useSearchParams } from "next/navigation";

import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { buildWorkspaceAgentPath } from "@/core/agents";
import { useI18n } from "@/core/i18n/hooks";
import { env } from "@/env";
import { cn } from "@/lib/utils";

export function WorkspaceHeader({ className }: { className?: string }) {
  const { t } = useI18n();
  const { state } = useSidebar();
  const pathname = usePathname();
  const params = useParams<{ agent_name?: string }>();
  const searchParams = useSearchParams();
  const newChatPath = buildWorkspaceAgentPath({
    agentName: params.agent_name ?? searchParams.get("agent_name") ?? "lead_agent",
    agentStatus: (searchParams.get("agent_status") as "dev" | "prod" | null) ?? "dev",
    executionBackend:
      searchParams.get("execution_backend") === "remote" ? "remote" : undefined,
    remoteSessionId: searchParams.get("remote_session_id") ?? undefined,
  });

  return (
    <>
      <div
        className={cn(
          "group/workspace-header flex h-12 flex-col justify-center",
          className,
        )}
      >
        {state === "collapsed" ? (
          <div className="group-has-data-[collapsible=icon]/sidebar-wrapper:-translate-y flex w-full cursor-pointer items-center justify-center">
            <div className="text-primary block pt-1 font-serif group-hover/workspace-header:hidden">
              DF
            </div>
            <SidebarTrigger className="hidden pl-2 group-hover/workspace-header:block" />
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            {env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true" ? (
              <Link href="/" className="text-primary ml-2 font-serif">
                OpenAgents
              </Link>
            ) : (
              <div className="text-primary ml-2 cursor-default font-serif">
                OpenAgents
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
            <Link className="text-muted-foreground" href={newChatPath}>
              <MessageSquarePlus size={16} />
              <span>{t.sidebar.newChat}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </>
  );
}
