import { ModelsTable } from "@/components/models/models-table";
import { useFetch } from "@/hooks/use-fetch";
import type { AdminModel } from "@/types";

export function ModelsPage() {
  const { data, error, isLoading, refetch } =
    useFetch<{ items: AdminModel[] }>("/api/admin/models");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Models</h2>
        <p className="text-muted-foreground">
          Maintain runtime model definitions from the `models` table
        </p>
      </div>
      {error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Failed to load models: {error}
        </div>
      ) : null}
      <ModelsTable
        isLoading={isLoading}
        models={data?.items ?? null}
        onRefetch={refetch}
      />
    </div>
  );
}
