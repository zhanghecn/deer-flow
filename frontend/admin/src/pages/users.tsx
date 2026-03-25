import { UsersTable } from "@/components/users/users-table";
import { useFetch } from "@/hooks/use-fetch";
import { t } from "@/i18n";
import type { AdminUser } from "@/types";

export function UsersPage() {
  const { data, isLoading, refetch } =
    useFetch<{ users: AdminUser[] }>("/api/admin/users");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">{t("Users")}</h2>
        <p className="text-muted-foreground">
          {t("Manage user accounts and roles")}
        </p>
      </div>
      <UsersTable
        users={data?.users ?? null}
        isLoading={isLoading}
        onRefetch={refetch}
      />
    </div>
  );
}
