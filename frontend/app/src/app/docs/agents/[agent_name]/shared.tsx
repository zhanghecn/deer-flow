import { CheckIcon, CopyIcon, ExternalLinkIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  buildPublicAgentDocsPath,
  buildPublicAgentPlaygroundPath,
  buildPublicAgentReferencePath,
} from "@/core/agents";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

import { getAgentPublicDocsShellText } from "./shared.i18n";

type PublicDocsTab = "overview" | "playground" | "reference";

export interface DeveloperDocsSidebarItem {
  label: string;
  href: string;
  helper?: string;
  badge?: string;
}

export interface DeveloperDocsSidebarSection {
  title: string;
  items: DeveloperDocsSidebarItem[];
}

export function InlineCodeText({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  const parts = value.split(/`([^`]+)`/g);

  return (
    <span className={className}>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <code
            key={`${part}-${index}`}
            className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[0.92em] text-zinc-800"
          >
            {part}
          </code>
        ) : (
          <span key={`${part}-${index}`}>{part}</span>
        ),
      )}
    </span>
  );
}

export function PublicDocsStatePanel({
  eyebrow,
  title,
  description,
  actionLabel,
  actionHref,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actionLabel?: string;
  actionHref?: string;
}) {
  return (
    <div className="min-h-screen bg-white px-4 py-20 text-zinc-900 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-2xl rounded-lg border border-zinc-200 bg-white px-7 py-8">
        <p className="text-[11px] font-medium tracking-[0.2em] text-zinc-400 uppercase">
          {eyebrow}
        </p>
        <h1 className="mt-4 text-[clamp(1.8rem,3vw,2.35rem)] leading-[1.06] font-semibold tracking-tight text-zinc-900">
          {title}
        </h1>
        <p className="mt-4 max-w-xl text-[15px] leading-6 text-zinc-500">
          <InlineCodeText value={description} />
        </p>
        {actionLabel && actionHref ? (
          <div className="mt-8">
            <Button asChild className="rounded-md">
              <Link to={actionHref}>{actionLabel}</Link>
            </Button>
          </div>
        ) : null}
      </section>
    </div>
  );
}

export function PublicDocsPageHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="max-w-[760px]">
      <p className="text-[11px] font-medium tracking-[0.2em] text-zinc-400 uppercase">
        {eyebrow}
      </p>
      <h1 className="mt-2 text-[clamp(1.75rem,2.4vw,2.4rem)] leading-[1.08] font-semibold tracking-tight text-zinc-900">
        {title}
      </h1>
      <p className="mt-2 max-w-[720px] text-[15px] leading-6 text-zinc-500">
        <InlineCodeText value={description} />
      </p>
    </div>
  );
}

export function DocsSectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="max-w-[720px]">
      <p className="text-[11px] font-medium tracking-[0.2em] text-zinc-400 uppercase">
        {eyebrow}
      </p>
      <h2 className="mt-1.5 text-[1.15rem] leading-[1.2] font-semibold tracking-tight text-zinc-900">
        {title}
      </h2>
      {description ? (
        <p className="mt-2 max-w-[680px] text-[13.5px] leading-6 text-zinc-500">
          <InlineCodeText value={description} />
        </p>
      ) : null}
    </div>
  );
}

export function DocsSurface({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-zinc-200 bg-white",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function DocsMethodBadge({ method }: { method: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 min-w-[52px] items-center justify-center rounded-md px-2.5 font-mono text-[10.5px] font-bold tracking-[0.08em] uppercase",
        getMethodToneClass(method),
      )}
    >
      {method.toUpperCase()}
    </span>
  );
}

export function DocsKeyValueGrid({
  items,
  columns = 4,
}: {
  items: Array<{
    label: string;
    value: string;
    mono?: boolean;
    description?: string;
  }>;
  columns?: 2 | 3 | 4;
}) {
  return (
    <DocsSurface className="overflow-hidden">
      <div
        className={cn(
          "grid divide-y divide-zinc-100 lg:divide-x lg:divide-y-0",
          columns === 2 && "lg:grid-cols-2",
          columns === 3 && "lg:grid-cols-3",
          columns === 4 && "lg:grid-cols-2 xl:grid-cols-4",
        )}
      >
        {items.map((item) => (
          <div key={item.label} className="px-5 py-4">
            <p className="text-[10.5px] font-medium tracking-[0.16em] text-zinc-400 uppercase">
              {item.label}
            </p>
            <p
              className={cn(
                "mt-1.5 text-[13px] leading-6 font-medium text-zinc-900",
                item.mono && "font-mono text-[12px] [overflow-wrap:anywhere]",
              )}
            >
              {item.value}
            </p>
            {item.description ? (
              <p className="mt-1 text-[12px] leading-5 text-zinc-400">
                {item.description}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </DocsSurface>
  );
}

export function CopyableCodeBlock({
  code,
  copyLabel,
  copiedLabel,
  title,
}: {
  code: string;
  copyLabel: string;
  copiedLabel: string;
  title?: string;
}) {
  const [isCopied, setIsCopied] = useState(false);

  useEffect(() => {
    if (!isCopied) {
      return;
    }

    const timerID = window.setTimeout(() => {
      setIsCopied(false);
    }, 1400);
    return () => {
      window.clearTimeout(timerID);
    };
  }, [isCopied]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code);
      setIsCopied(true);
      toast.success(copiedLabel);
    } catch {
      toast.error(copyLabel);
    }
  }

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-800 bg-[#0d1117]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-700/60 px-4 py-2.5">
        <div className="flex items-center gap-3">
          {title ? (
            <p className="font-mono text-[11px] tracking-[0.14em] text-zinc-400 uppercase">
              {title}
            </p>
          ) : null}
        </div>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 rounded-md text-zinc-400 hover:bg-zinc-700/50 hover:text-zinc-200"
          onClick={handleCopy}
        >
          {isCopied ? (
            <CheckIcon className="size-3.5" />
          ) : (
            <CopyIcon className="size-3.5" />
          )}
          {isCopied ? copiedLabel : copyLabel}
        </Button>
      </div>

      <ScrollArea className="max-h-[460px] px-4 py-4">
        <pre className="overflow-x-auto font-mono text-[12.5px] leading-6 whitespace-pre-wrap text-zinc-200">
          {code}
        </pre>
      </ScrollArea>
    </div>
  );
}

function HeaderLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 text-[13px] text-zinc-400 transition-colors hover:text-zinc-600"
    >
      {label}
      <ExternalLinkIcon className="size-3.5" />
    </a>
  );
}

function SidebarHrefActive(href: string, pathname: string, hash: string) {
  if (href.startsWith("#")) {
    return hash === href || (!hash && href === "#overview");
  }

  const url = new URL(href, "https://openagents.local");
  return pathname === url.pathname && (!url.hash || hash === url.hash);
}

function SidebarItem({ item, dark }: { item: DeveloperDocsSidebarItem; dark?: boolean }) {
  const location = useLocation();
  const isActive = SidebarHrefActive(
    item.href,
    location.pathname,
    location.hash,
  );

  if (dark) {
    return (
      <a
        href={item.href}
        className={cn(
          "block rounded-md px-3 py-2 text-[13px] transition-colors",
          isActive
            ? "bg-white/10 text-white"
            : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200",
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium">{item.label}</span>
          {item.badge ? (
            <span
              className={cn(
                "rounded px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase",
                getMethodBadgeDarkClass(item.badge),
              )}
            >
              {item.badge}
            </span>
          ) : null}
        </div>
        {item.helper ? (
          <p className="mt-0.5 font-mono text-[10.5px] leading-4 text-zinc-500">
            {item.helper}
          </p>
        ) : null}
      </a>
    );
  }

  return (
    <a
      href={item.href}
      className={cn(
        "block rounded-md px-3 py-2 text-[13px] transition-colors",
        isActive
          ? "bg-zinc-100 text-zinc-900"
          : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-700",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{item.label}</span>
        {item.badge ? (
          <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[9px] font-bold text-zinc-600 uppercase">
            {item.badge}
          </span>
        ) : null}
      </div>
      {item.helper ? (
        <p className="mt-0.5 font-mono text-[10.5px] leading-4 text-zinc-400">
          {item.helper}
        </p>
      ) : null}
    </a>
  );
}

function getMethodToneClass(method: string) {
  switch (method.toUpperCase()) {
    case "POST":
      return "bg-blue-600 text-white";
    case "GET":
      return "bg-emerald-600 text-white";
    case "DELETE":
      return "bg-red-500 text-white";
    case "PUT":
    case "PATCH":
      return "bg-amber-500 text-white";
    default:
      return "bg-zinc-500 text-white";
  }
}

function getMethodBadgeDarkClass(method: string) {
  switch (method.toUpperCase()) {
    case "POST":
      return "bg-blue-500/20 text-blue-300";
    case "GET":
      return "bg-emerald-500/20 text-emerald-300";
    case "DELETE":
      return "bg-red-500/20 text-red-300";
    case "PUT":
    case "PATCH":
      return "bg-amber-500/20 text-amber-300";
    default:
      return "bg-zinc-500/20 text-zinc-300";
  }
}

export function DeveloperDocsShell({
  activeTab,
  agentName,
  openapiURL,
  exportURL,
  sidebarSections = [],
  children,
}: {
  activeTab: PublicDocsTab;
  agentName: string;
  openapiURL?: string | null;
  exportURL?: string | null;
  sidebarSections?: DeveloperDocsSidebarSection[];
  children: React.ReactNode;
}) {
  const { locale } = useI18n();
  const text = getAgentPublicDocsShellText(locale);

  const navigationItems = useMemo(
    () => [
      {
        id: "overview" as const,
        label: text.tabOverview,
        href: buildPublicAgentDocsPath(agentName),
      },
      {
        id: "playground" as const,
        label: text.tabPlayground,
        href: buildPublicAgentPlaygroundPath(agentName),
      },
      {
        id: "reference" as const,
        label: text.tabReference,
        href: buildPublicAgentReferencePath(agentName),
      },
    ],
    [
      agentName,
      text.tabOverview,
      text.tabPlayground,
      text.tabReference,
    ],
  );

  return (
    <div className="min-h-screen bg-white text-zinc-900">
      {/* Top header bar */}
      <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-2">
            <Link
              to={buildPublicAgentDocsPath(agentName)}
              className="text-[13px] font-medium text-zinc-900 hover:text-zinc-600"
            >
              {text.homeLabel}
            </Link>
            <span className="text-zinc-300">/</span>
            <p className="truncate font-mono text-[12px] text-zinc-500">
              {agentName}
            </p>
          </div>

          <div className="flex items-center gap-4">
            {openapiURL ? (
              <HeaderLink href={openapiURL} label={text.rawOpenAPI} />
            ) : null}
            {exportURL ? (
              <HeaderLink href={exportURL} label={text.rawExport} />
            ) : null}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1600px] lg:flex">
        {/* Dark sidebar */}
        <aside className="hidden w-[260px] shrink-0 lg:block">
          <div className="sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto border-r border-zinc-800 bg-[#111827]">
            <div className="px-4 pt-6 pb-4">
              {/* Tab nav inside sidebar */}
              <nav className="space-y-0.5">
                {navigationItems.map((item) => (
                  <NavLink
                    key={item.id}
                    to={item.href}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-3 py-2 text-[13px] font-medium transition-colors",
                      activeTab === item.id
                        ? "bg-white/10 text-white"
                        : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200",
                    )}
                  >
                    {item.label}
                  </NavLink>
                ))}
              </nav>

              {/* Sidebar sections */}
              {sidebarSections.map((section) => (
                <div key={section.title} className="mt-6">
                  <p className="px-3 text-[10px] font-semibold tracking-[0.16em] text-zinc-500 uppercase">
                    {section.title}
                  </p>
                  <div className="mt-2 space-y-0.5">
                    {section.items.map((item) => (
                      <SidebarItem
                        key={`${section.title}-${item.href}`}
                        item={item}
                        dark
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* Content */}
        <main className="min-w-0 flex-1 px-4 py-8 sm:px-6 lg:px-10">
          <div className="mx-auto max-w-[960px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
