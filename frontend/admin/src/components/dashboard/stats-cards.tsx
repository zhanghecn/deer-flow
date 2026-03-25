import { Activity, MessageSquare, Users, Zap } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/i18n";
import { formatTokens } from "@/lib/format";
import type { AdminStats } from "@/types";

interface StatsCardsProps {
  stats: AdminStats | null;
  isLoading: boolean;
}

const cards = [
  {
    title: "Total Users",
    key: "user_count" as const,
    icon: Users,
    format: (v: number) => v.toString(),
    color: "text-blue-600 dark:text-blue-400",
    bg: "bg-blue-50 dark:bg-blue-950",
  },
  {
    title: "Total Traces",
    key: "trace_count" as const,
    icon: Activity,
    format: (v: number) => v.toString(),
    color: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-50 dark:bg-emerald-950",
  },
  {
    title: "Token Usage",
    key: "total_tokens_in" as const,
    icon: Zap,
    format: (_v: number, stats: AdminStats) =>
      t("{input} in / {output} out", {
        input: formatTokens(stats.total_tokens_in),
        output: formatTokens(stats.total_tokens_out),
      }),
    color: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-50 dark:bg-amber-950",
  },
  {
    title: "Active Threads",
    key: "thread_count" as const,
    icon: MessageSquare,
    format: (v: number) => v.toString(),
    color: "text-purple-600 dark:text-purple-400",
    bg: "bg-purple-50 dark:bg-purple-950",
  },
];

export function StatsCards({ stats, isLoading }: StatsCardsProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.title}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t(card.title)}</CardTitle>
            <div className={`rounded-md p-2 ${card.bg}`}>
              <card.icon className={`h-4 w-4 ${card.color}`} />
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-7 w-24" />
            ) : (
              <div className="text-2xl font-bold">
                {stats ? card.format(stats[card.key], stats) : "-"}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
