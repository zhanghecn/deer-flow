"use client";

import type { ContextWindowState } from "@/core/threads";
import { cn } from "@/lib/utils";

function formatPercent(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }
  return `${Math.round(value * 100)}%`;
}

function formatCompactCount(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "—";
  }

  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return new Intl.NumberFormat("en-US").format(Math.round(value));
}

function usageToneClass(usageRatio?: number | null) {
  if (typeof usageRatio !== "number" || Number.isNaN(usageRatio)) {
    return "text-muted-foreground";
  }

  if (usageRatio >= 0.95) {
    return "text-rose-600 dark:text-rose-300";
  }

  if (usageRatio >= 0.8) {
    return "text-amber-600 dark:text-amber-300";
  }

  return "text-muted-foreground";
}

export function ContextWindowCard({
  contextWindow,
  className,
}: {
  contextWindow?: ContextWindowState;
  className?: string;
}) {
  if (!contextWindow) {
    return null;
  }

  const usagePercent = formatPercent(contextWindow.usage_ratio) ?? "—";
  const compactedPercent = formatPercent(contextWindow.usage_ratio_after_summary);
  const tokenSummary = `${formatCompactCount(contextWindow.approx_input_tokens)} / ${formatCompactCount(contextWindow.max_input_tokens)}`;
  const details = [`Context ${usagePercent}`, tokenSummary];

  if (contextWindow.summary_applied && compactedPercent) {
    details.push(`after compact ${compactedPercent}`);
  } else if (contextWindow.triggered) {
    details.push("near limit");
  } else if (
    typeof contextWindow.summary_count === "number" &&
    contextWindow.summary_count > 0
  ) {
    details.push(
      `${contextWindow.summary_count} summary${contextWindow.summary_count > 1 ? " runs" : ""}`,
    );
  }

  return (
    <p
      aria-live="polite"
      className={cn(
        "min-w-0 truncate whitespace-nowrap text-[11px] tabular-nums",
        usageToneClass(contextWindow.usage_ratio),
        className,
      )}
      title={details.join(" · ")}
    >
      {details.join(" · ")}
    </p>
  );
}
