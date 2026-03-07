import { LLMKeysTable } from "@/components/llm-keys/llm-keys-table";
import { useFetch } from "@/hooks/use-fetch";
import type { LLMProviderKey } from "@/types";

export function LLMKeysPage() {
  const { data, isLoading, refetch } =
    useFetch<{ items: LLMProviderKey[] }>("/api/admin/llm-keys");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">LLM Provider Keys</h2>
        <p className="text-muted-foreground">
          Manage API keys for LLM providers
        </p>
      </div>
      <LLMKeysTable
        keys={data?.items ?? null}
        isLoading={isLoading}
        onRefetch={refetch}
      />
    </div>
  );
}
