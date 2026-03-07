import { CheckCircle, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { CheckpointStatus } from "@/types";

interface CheckpointCardProps {
  status: CheckpointStatus | null;
  isLoading: boolean;
}

export function CheckpointCard({ status, isLoading }: CheckpointCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Checkpoint Status</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-8 w-full" />
        ) : !status ? (
          <p className="text-sm text-muted-foreground">Unable to load</p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              {status.enabled ? (
                <CheckCircle className="h-5 w-5 text-emerald-500" />
              ) : (
                <XCircle className="h-5 w-5 text-red-500" />
              )}
              <span className="text-sm font-medium">
                {status.enabled ? "Enabled" : "Not Configured"}
              </span>
            </div>
            {status.tables.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {status.tables.map((t) => (
                  <Badge key={t.name} variant="secondary" className="text-xs">
                    {t.name}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
