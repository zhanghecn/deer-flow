import {
  BugIcon,
  ChevronsUpDown,
  GlobeIcon,
  InfoIcon,
  LogOutIcon,
  MailIcon,
  Settings2Icon,
  ShieldIcon,
} from "lucide-react";
import { lazy, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

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
import {
  APP_INITIALS,
  GITHUB_ISSUES_URL,
  GITHUB_REPO_URL,
  OFFICIAL_WEBSITE_URL,
  PUBLIC_GITHUB_REPO_AVAILABLE,
} from "@/core/config/site";
import { useI18n } from "@/core/i18n/hooks";

import { GithubIcon } from "./github-icon";

const SettingsDialog = lazy(
  () => import("./settings/settings-dialog").then((m) => ({ default: m.SettingsDialog })),
);

function initialsOf(label: string): string {
  const cleaned = label.trim();
  if (!cleaned) {
    return APP_INITIALS;
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
    <div className="border-sidebar-border/60 bg-sidebar-accent/35 flex w-full items-center gap-2 rounded-lg border p-1.5 text-left">
      <Avatar className="size-8 rounded-lg">
        <AvatarImage src={avatarURL ?? undefined} alt={displayName} />
        <AvatarFallback className="rounded-lg bg-cyan-200/85 text-xs font-semibold text-cyan-950">
          {initials}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="text-sidebar-foreground truncate text-sm font-medium">
          {displayName}
        </p>
        <p className="text-muted-foreground truncate text-xs">
          {secondaryLine}
        </p>
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
  const navigate = useNavigate();
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
    hydratedUser?.email?.trim() ??
    hydratedUser?.role?.toUpperCase() ??
    t.workspace.userRoleFallback;
  const userInitials = initialsOf(displayName);
  const isAdmin = hydratedUser?.role === "admin";

  const handleLogout = () => {
    logout();
    void navigate("/login");
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
                    <p className="truncate text-sm font-medium">
                      {displayName}
                    </p>
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
                  <DropdownMenuItem asChild>
                    <a
                      href={OFFICIAL_WEBSITE_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <GlobeIcon />
                      {t.workspace.officialWebsite}
                    </a>
                  </DropdownMenuItem>
                  {PUBLIC_GITHUB_REPO_AVAILABLE && (
                    <DropdownMenuItem asChild>
                      <a
                        href={GITHUB_REPO_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <GithubIcon />
                        {t.workspace.visitGithub}
                      </a>
                    </DropdownMenuItem>
                  )}
                  {isAdmin && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem asChild>
                        <a
                          href="/admin/"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <ShieldIcon />
                          {t.workspace.adminConsole}
                        </a>
                      </DropdownMenuItem>
                    </>
                  )}
                  {PUBLIC_GITHUB_REPO_AVAILABLE && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem asChild>
                        <a
                          href={GITHUB_ISSUES_URL}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <BugIcon />
                          {t.workspace.reportIssue}
                        </a>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <a
                          href={GITHUB_ISSUES_URL}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <MailIcon />
                          {t.workspace.contactUs}
                        </a>
                      </DropdownMenuItem>
                    </>
                  )}
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
