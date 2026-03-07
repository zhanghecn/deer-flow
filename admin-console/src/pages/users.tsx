import { UsersTable } from "@/components/users/users-table";
import { useFetch } from "@/hooks/use-fetch";
import type { AdminUser } from "@/types";

export function UsersPage() {
  const { data, isLoading, refetch } =
    useFetch<{ users: AdminUser[] }>("/api/admin/users");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Users</h2>
        <p className="text-muted-foreground">
          Manage user accounts and roles
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
