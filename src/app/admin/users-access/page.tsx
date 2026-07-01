import { PageHeader } from "@/components/layout/page-header";
import { UsersAccessTable, type UserRow } from "@/components/users/users-access-table";
import { prisma } from "@/lib/db";
import { CATEGORIES } from "@/lib/constants";

export const dynamic = "force-dynamic";
export const metadata = { title: "Users & API Access - Local AI Gateway" };

export default async function UsersAccessPage() {
  const users = await prisma.user.findMany({
    orderBy: [{ role: "asc" }, { name: "asc" }],
    include: {
      apiAccess: true,
      apiKeys: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  const rows: UserRow[] = users.map((u) => {
    const access: Record<string, boolean> = {};
    for (const c of CATEGORIES) {
      access[c] = u.apiAccess.find((a) => a.category === c)?.enabled ?? false;
    }
    const key = u.apiKeys[0];
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      status: u.status,
      key: key ? { prefix: key.keyPrefix, last4: key.last4, status: key.status } : null,
      access,
    };
  });

  return (
    <>
      <PageHeader
        title="Users & API Access"
        description="Manage users, roles, API keys, and per-category API access."
      />
      <UsersAccessTable users={rows} />
    </>
  );
}
