import { ChevronDownIcon } from "lucide-react";
import { type ReactNode, useState } from "react";

import { cn } from "@/lib/utils";

export function FieldLabel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "text-muted-foreground text-[11px] font-medium tracking-[0.18em] uppercase",
        className,
      )}
    >
      {children}
    </p>
  );
}

type SectionCardProps = {
  eyebrow: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
  actions?: ReactNode;
  defaultCollapsed?: boolean;
  collapsible?: boolean;
};

export function SectionCard({
  eyebrow,
  title,
  description,
  children,
  actions,
  collapsible = false,
  defaultCollapsed = false,
}: SectionCardProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <section className="border-border/70 bg-background/95 rounded-3xl border p-5 shadow-xs">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground border-border/70 bg-muted/35 flex size-8 items-center justify-center rounded-2xl border">
          {eyebrow}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="text-muted-foreground mt-0.5 text-xs leading-5">
            {description}
          </p>
        </div>
        {actions}
        {collapsible && (
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className="text-muted-foreground hover:text-foreground ml-2 rounded-lg p-1 transition-colors"
          >
            <ChevronDownIcon
              className={cn(
                "size-4 transition-transform",
                collapsed && "-rotate-90",
              )}
            />
          </button>
        )}
      </div>
      {(!collapsible || !collapsed) && (
        <div className="mt-5 space-y-4">{children}</div>
      )}
    </section>
  );
}

export function StatCard({
  label,
  value,
  onClick,
}: {
  label: string;
  value: string | number;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "border-border/70 bg-muted/20 rounded-3xl border p-4 text-left transition-colors",
        onClick && "hover:bg-muted/40 cursor-pointer",
      )}
    >
      <FieldLabel>{label}</FieldLabel>
      <p className="mt-3 text-2xl font-semibold tabular-nums">{value}</p>
    </button>
  );
}
