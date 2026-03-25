import { Zap } from "lucide-react";
import { t } from "@/i18n";
import { formatTokens } from "@/lib/format";
import type { TraceItem } from "@/types";

interface TokenSummaryProps {
  trace: TraceItem;
}

export function TokenSummary({ trace }: TokenSummaryProps) {
  const total = trace.total_tokens || 1;
  const inPct = Math.round((trace.input_tokens / total) * 100);

  return (
    <div className="rounded-md border p-3 space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Zap className="h-4 w-4 text-amber-500" />
        {t("Token Usage")}
      </div>
      <div className="flex h-2 rounded-full overflow-hidden bg-muted">
        <div
          className="bg-blue-500 transition-all"
          style={{ width: `${inPct}%` }}
        />
        <div
          className="bg-emerald-500 transition-all"
          style={{ width: `${100 - inPct}%` }}
        />
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{t("Input: {input}", { input: formatTokens(trace.input_tokens) })}</span>
        <span>{t("Output: {output}", { output: formatTokens(trace.output_tokens) })}</span>
        <span className="font-medium text-foreground">
          {t("Total: {total}", { total: formatTokens(trace.total_tokens) })}
        </span>
      </div>
    </div>
  );
}
