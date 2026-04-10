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
            className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[0.92em] text-slate-900"
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
    <div className="min-h-screen bg-white px-4 py-20 text-slate-950 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-3xl rounded-xl border border-slate-200 bg-white px-8 py-10">
        <p className="text-[11px] font-medium tracking-[0.22em] text-slate-500 uppercase">
          {eyebrow}
        </p>
        <h1 className="mt-4 text-[clamp(2rem,4vw,2.75rem)] leading-[1.02] font-semibold tracking-[-0.045em] text-slate-950">
          {title}
        </h1>
        <p className="mt-4 max-w-2xl text-[15px] leading-8 text-slate-600">
          <InlineCodeText value={description} />
        </p>
        {actionLabel && actionHref ? (
          <div className="mt-8">
            <Button asChild className="rounded-full">
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
    <div className="max-w-[960px]">
      <p className="text-[11px] font-medium tracking-[0.22em] text-slate-500 uppercase">
        {eyebrow}
      </p>
      <h1 className="mt-4 text-[clamp(2rem,3.1vw,3rem)] leading-[1.02] font-semibold tracking-[-0.05em] text-slate-950">
        {title}
      </h1>
      <p className="mt-4 max-w-[900px] text-[16px] leading-8 text-slate-600">
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
    <div className="max-w-[920px]">
      <p className="text-[11px] font-medium tracking-[0.22em] text-slate-500 uppercase">
        {eyebrow}
      </p>
      <h2 className="mt-3 text-[1.5rem] leading-[1.1] font-semibold tracking-[-0.04em] text-slate-950">
        {title}
      </h2>
      {description ? (
        <p className="mt-3 max-w-[880px] text-[15px] leading-8 text-slate-600">
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
    <section
      className={cn("rounded-xl border border-slate-200 bg-white", className)}
    >
      {children}
    </section>
  );
}

export function DocsMethodBadge({ method }: { method: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-7 min-w-[64px] items-center justify-center rounded-md border px-3 font-mono text-[11px] font-semibold tracking-[0.16em] uppercase",
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
          "grid divide-y divide-slate-200 lg:divide-x lg:divide-y-0",
          columns === 2 && "lg:grid-cols-2",
          columns === 3 && "lg:grid-cols-3",
          columns === 4 && "lg:grid-cols-2 xl:grid-cols-4",
        )}
      >
        {items.map((item) => (
          <div key={item.label} className="px-5 py-5">
            <p className="text-[11px] font-medium tracking-[0.18em] text-slate-500 uppercase">
              {item.label}
            </p>
            <p
              className={cn(
                "mt-2 text-sm leading-6 font-medium text-slate-950",
                item.mono && "font-mono text-[13px] [overflow-wrap:anywhere]",
              )}
            >
              {item.value}
            </p>
            {item.description ? (
              <p className="mt-2 text-sm leading-6 text-slate-500">
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
    <DocsSurface className="overflow-hidden rounded-xl border-slate-200 bg-slate-950 text-slate-100">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
        <div className="flex items-center gap-3">
          {title ? (
            <p className="font-mono text-[12px] tracking-[0.18em] text-slate-400 uppercase">
              {title}
            </p>
          ) : null}
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="rounded-full border-white/10 bg-white/5 text-slate-100 hover:bg-white/10"
          onClick={handleCopy}
        >
          {isCopied ? (
            <CheckIcon className="size-4" />
          ) : (
            <CopyIcon className="size-4" />
          )}
          {isCopied ? copiedLabel : copyLabel}
        </Button>
      </div>

      <ScrollArea className="max-h-[520px] px-5 py-5">
        <pre className="overflow-x-auto font-mono text-[13px] leading-6 whitespace-pre-wrap text-slate-100">
          {code}
        </pre>
      </ScrollArea>
    </DocsSurface>
  );
}

function HeaderLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 transition-colors hover:text-slate-950"
    >
      {label}
      <ExternalLinkIcon className="size-4" />
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

function SidebarItem({ item }: { item: DeveloperDocsSidebarItem }) {
  const location = useLocation();
  const isActive = SidebarHrefActive(
    item.href,
    location.pathname,
    location.hash,
  );

  return (
    <a
      href={item.href}
      className={cn(
        "block rounded-lg border border-transparent px-3 py-2.5 transition-colors",
        isActive
          ? "border-slate-200 bg-slate-50 text-slate-950"
          : "text-slate-600 hover:bg-slate-50 hover:text-slate-950",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{item.label}</span>
        {item.badge ? (
          <span className="rounded-full bg-slate-200 px-2 py-0.5 font-mono text-[10px] text-slate-600 uppercase">
            {item.badge}
          </span>
        ) : null}
      </div>
      {item.helper ? (
        <p className="mt-1.5 font-mono text-[11px] leading-5 [overflow-wrap:anywhere] text-slate-500">
          {item.helper}
        </p>
      ) : null}
    </a>
  );
}

function getMethodToneClass(method: string) {
  switch (method.toUpperCase()) {
    case "POST":
      return "border-slate-950 bg-slate-950 text-white";
    case "GET":
      return "border-emerald-200 bg-emerald-50 text-emerald-900";
    case "DELETE":
      return "border-rose-200 bg-rose-50 text-rose-900";
    case "PUT":
    case "PATCH":
      return "border-amber-200 bg-amber-50 text-amber-900";
    default:
      return "border-slate-200 bg-slate-100 text-slate-900";
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
    [agentName, text.tabOverview, text.tabPlayground, text.tabReference],
  );

  return (
    <div className="min-h-screen bg-white text-slate-950">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto max-w-[1560px] px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <p className="text-[11px] font-medium tracking-[0.22em] text-slate-500 uppercase">
                {text.eyebrow}
              </p>
              <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-2 text-sm">
                <Link
                  to={buildPublicAgentDocsPath(agentName)}
                  className="font-medium text-slate-950"
                >
                  {text.homeLabel}
                </Link>
                <span className="text-slate-300">/</span>
                <p className="truncate font-mono text-[13px] text-slate-600">
                  {agentName}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              {openapiURL ? (
                <HeaderLink href={openapiURL} label={text.rawOpenAPI} />
              ) : null}
              {exportURL ? (
                <HeaderLink href={exportURL} label={text.rawExport} />
              ) : null}
            </div>
          </div>
        </div>
        <div className="mx-auto max-w-[1560px] px-4 sm:px-6 lg:px-8">
          <nav className="flex gap-6 overflow-x-auto">
            {navigationItems.map((item) => (
              <NavLink
                key={item.id}
                to={item.href}
                className={cn(
                  "border-b-2 py-3 text-sm font-medium whitespace-nowrap transition-colors",
                  activeTab === item.id
                    ? "border-slate-950 text-slate-950"
                    : "border-transparent text-slate-500 hover:text-slate-950",
                )}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-4 py-8 sm:px-6 lg:grid lg:grid-cols-[256px_minmax(0,1fr)] lg:gap-12 lg:px-8">
        {/* Keep the left rail narrow and static so the content column can stay
            wide enough for code, tables, and long endpoint names. */}
        <aside className="hidden lg:block">
          <div className="sticky top-28 pr-8">
            <ScrollArea className="h-[calc(100vh-8rem)]">
              <div className="space-y-8 border-r border-slate-200 pr-8">
                <section>
                  <p className="px-3 text-[11px] font-medium tracking-[0.22em] text-slate-500 uppercase">
                    {text.pagesLabel}
                  </p>
                  <div className="mt-2 space-y-1">
                    {navigationItems.map((item) => (
                      <SidebarItem
                        key={item.id}
                        item={{
                          label: item.label,
                          href: item.href,
                        }}
                      />
                    ))}
                  </div>
                </section>

                {sidebarSections.map((section) => (
                  <section key={section.title}>
                    <p className="px-3 text-[11px] font-medium tracking-[0.22em] text-slate-500 uppercase">
                      {section.title}
                    </p>
                    <div className="mt-2 space-y-1">
                      {section.items.map((item) => (
                        <SidebarItem
                          key={`${section.title}-${item.href}`}
                          item={item}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </ScrollArea>
          </div>
        </aside>

        {/* The docs surfaces carry wide code blocks, schema tables, and the
            standalone playground, so keep the main column broader than the
            default workspace content width. */}
        <div className="max-w-[1200px] min-w-0">{children}</div>
      </main>
    </div>
  );
}
