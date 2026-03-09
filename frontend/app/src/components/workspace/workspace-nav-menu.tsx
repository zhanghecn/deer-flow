"use client";

import {
  BugIcon,
  ChevronsUpDown,
  GlobeIcon,
  InfoIcon,
  LogOutIcon,
  MailIcon,
  Settings2Icon,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useAuth } from "@/core/auth/hooks";
import { useI18n } from "@/core/i18n/hooks";

import { GithubIcon } from "./github-icon";

const SettingsDialog = dynamic(
  () => import("./settings/settings-dialog").then((m) => m.SettingsDialog),
  { ssr: false },
);

function initialsOf(label: string): string {
  const cleaned = label.trim();
  if (!cleaned) {
    return "OA";
  }
  const segments = cleaned
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "");
  if (segments.length > 0) {
    return segments.join("");
  }
  return cleaned.slice(0, 2).toUpperCase();
}

function NavMenuButtonContent({
  isSidebarOpen,
  displayName,
  secondaryLine,
  avatarURL,
  initials,
}: {
  isSidebarOpen: boolean;
  displayName: string;
  secondaryLine: string;
  avatarURL?: string | null;
  initials: string;
}) {
  return isSidebarOpen ? (
    <div className="flex w-full items-center gap-2 rounded-lg border border-sidebar-border/60 bg-sidebar-accent/35 p-1.5 text-left">
      <Avatar className="size-8 rounded-lg">
        <AvatarImage src={avatarURL ?? undefined} alt={displayName} />
        <AvatarFallback className="rounded-lg bg-cyan-200/85 text-xs font-semibold text-cyan-950">
          {initials}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-sidebar-foreground">
          {displayName}
        </p>
        <p className="text-muted-foreground truncate text-xs">{secondaryLine}</p>
      </div>
      <ChevronsUpDown className="text-muted-foreground ml-auto size-4" />
    </div>
  ) : (
    <div className="flex size-full items-center justify-center">
      <Avatar className="size-7 rounded-md">
        <AvatarImage src={avatarURL ?? undefined} alt={displayName} />
        <AvatarFallback className="rounded-md bg-cyan-200/85 text-[10px] font-semibold text-cyan-950">
          {initials}
        </AvatarFallback>
      </Avatar>
    </div>
  );
}

export function WorkspaceNavMenu() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDefaultSection, setSettingsDefaultSection] = useState<
    "appearance" | "tools" | "skills" | "notification" | "about"
  >("appearance");
  const [mounted, setMounted] = useState(false);
  const router = useRouter();
  const { open: isSidebarOpen } = useSidebar();
  const { t } = useI18n();
  const { user, logout } = useAuth();

  useEffect(() => {
    setMounted(true);
  }, []);

  const hydratedUser = mounted ? user : null;
  const displayName =
    hydratedUser?.name?.trim() ??
    hydratedUser?.email?.trim() ??
    t.workspace.settingsAndMore;
  const secondaryLine =
    hydratedUser?.email?.trim() ?? hydratedUser?.role?.toUpperCase() ?? "USER";
  const userInitials = initialsOf(displayName);

  const handleLogout = () => {
    logout();
    router.push("/login");
  };

  return (
    <>
      {settingsOpen && (
        <SettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          defaultSection={settingsDefaultSection}
        />
      )}
      <SidebarMenu className="w-full">
        <SidebarMenuItem>
          {mounted ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                >
                  <NavMenuButtonContent
                    isSidebarOpen={isSidebarOpen}
                    displayName={displayName}
                    secondaryLine={secondaryLine}
                    avatarURL={hydratedUser?.avatar_url}
                    initials={userInitials}
                  />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
                align="end"
                sideOffset={4}
              >
                <DropdownMenuGroup>
                  <div className="space-y-0.5 rounded-md px-2 py-1.5">
                    <p className="truncate text-sm font-medium">{displayName}</p>
                    <p className="text-muted-foreground truncate text-xs">
                      {secondaryLine}
                    </p>
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => {
                      setSettingsDefaultSection("appearance");
                      setSettingsOpen(true);
                    }}
                  >
                    <Settings2Icon />
                    {t.common.settings}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <a
                    href="https://openagents.tech/"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <DropdownMenuItem>
                      <GlobeIcon />
                      {t.workspace.officialWebsite}
                    </DropdownMenuItem>
                  </a>
                  <a
                    href="https://github.com/bytedance/openagents"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <DropdownMenuItem>
                      <GithubIcon />
                      {t.workspace.visitGithub}
                    </DropdownMenuItem>
                  </a>
                  <DropdownMenuSeparator />
                  <a
                    href="https://github.com/bytedance/openagents/issues"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <DropdownMenuItem>
                      <BugIcon />
                      {t.workspace.reportIssue}
                    </DropdownMenuItem>
                  </a>
                  <a href="mailto:support@openagents.tech">
                    <DropdownMenuItem>
                      <MailIcon />
                      {t.workspace.contactUs}
                    </DropdownMenuItem>
                  </a>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => {
                    setSettingsDefaultSection("about");
                    setSettingsOpen(true);
                  }}
                >
                  <InfoIcon />
                  {t.workspace.about}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={handleLogout}
                >
                  <LogOutIcon />
                  {t.common.logout}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <SidebarMenuButton size="lg" className="pointer-events-none">
              <NavMenuButtonContent
                isSidebarOpen={isSidebarOpen}
                displayName={displayName}
                secondaryLine={secondaryLine}
                avatarURL={hydratedUser?.avatar_url}
                initials={userInitials}
              />
            </SidebarMenuButton>
          )}
        </SidebarMenuItem>
      </SidebarMenu>
    </>
  );
}
