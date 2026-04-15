import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { t } from "@/i18n";
import { formatAgo } from "@/lib/format";
import type { TraceItem } from "@/types";

interface RecentTracesProps {
  traces: TraceItem[] | null;
  isLoading: boolean;
}

function statusVariant(status: string) {
  switch (status) {
    case "completed":
      return "default" as const;
    case "error":
      return "destructive" as const;
    default:
      return "secondary" as const;
  }
}

export function RecentTraces({ traces, isLoading }: RecentTracesProps) {
  const items = traces?.slice(0, 5) ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("Recent Traces")}</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            {t("No traces yet")}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("Agent")}</TableHead>
                <TableHead>{t("Status")}</TableHead>
                <TableHead>{t("Tokens")}</TableHead>
                <TableHead>{t("Time")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((trace) => (
                <TableRow key={trace.trace_id}>
                  <TableCell className="font-medium">
                    {trace.agent_name || trace.trace_id}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(trace.status)}>
                      {t(trace.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {trace.total_tokens}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatAgo(trace.started_at)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
