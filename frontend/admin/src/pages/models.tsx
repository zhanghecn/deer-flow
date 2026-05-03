import { useMemo, useState } from "react";

import { ModelsTable } from "@/components/models/models-table";
import { useFetch } from "@/hooks/use-fetch";
import { t } from "@/i18n";
import type { AdminModel } from "@/types";

interface AdminModelsPageResponse {
  items: AdminModel[];
  page: number;
  page_size: number;
  total: number;
}

export function ModelsPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const modelsPath = useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      page_size: String(pageSize),
    });
    const normalizedSearch = search.trim();
    if (normalizedSearch) {
      params.set("search", normalizedSearch);
    }
    return `/api/admin/models?${params.toString()}`;
  }, [page, pageSize, search]);

  const { data, error, isLoading, refetch } =
    useFetch<AdminModelsPageResponse>(modelsPath);
  const total = data?.total ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">{t("Models")}</h2>
        <p className="text-muted-foreground">
          {t("Maintain runtime model definitions from the `models` table")}
        </p>
      </div>
      {error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {t("Failed to load models: {error}", { error })}
        </div>
      ) : null}
      <ModelsTable
        isLoading={isLoading}
        models={data?.items ?? null}
        page={page}
        pageSize={pageSize}
        search={search}
        total={total}
        onPageChange={setPage}
        onPageSizeChange={(nextPageSize) => {
          setPageSize(nextPageSize);
          setPage(1);
        }}
        onRefetch={refetch}
        onSearchChange={(nextSearch) => {
          setSearch(nextSearch);
          setPage(1);
        }}
      />
    </div>
  );
}
