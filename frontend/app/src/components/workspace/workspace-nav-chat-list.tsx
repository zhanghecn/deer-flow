"use client";

import { BotIcon, MessagesSquare, ShieldIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useAuth } from "@/core/auth/hooks";
import { useI18n } from "@/core/i18n/hooks";

export function WorkspaceNavChatList() {
  const { t } = useI18n();
  const pathname = usePathname();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  return (
    <SidebarGroup className="pt-1">
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton isActive={pathname === "/workspace/chats"} asChild>
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
          <SidebarMenuButton
            isActive={pathname.startsWith("/workspace/agents")}
            asChild
          >
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
        {isAdmin && (
          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <a
                className="text-muted-foreground"
                href="/admin/"
                target="_blank"
                rel="noopener noreferrer"
              >
                <ShieldIcon />
                <span>Admin Console</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        )}
      </SidebarMenu>
    </SidebarGroup>
  );
}
