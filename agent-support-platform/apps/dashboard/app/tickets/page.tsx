import { fetchTickets, fetchUsers } from "@/lib/api";
import { getServerApiToken } from "@/lib/auth-server";
import { RealtimeRefresh } from "@/lib/realtime-refresh";
import { FiltersBar } from "./_components/filters-bar";
import { KanbanBoard } from "./_components/kanban-board";

export const dynamic = "force-dynamic";

export default async function TicketsPage() {
  const token = await getServerApiToken();
  let data;
  let error: string | null = null;
  try {
    data = await fetchTickets({ limit: 200 }, token);
  } catch (e) {
    error = e instanceof Error ? e.message : "Unknown error";
  }
  const users = await fetchUsers(token).catch(() => []);

  const closedCount =
    data?.tickets.reduce((n, t) => (t.status === "closed" ? n + 1 : n), 0) ?? 0;

  return (
    <div className="space-y-4">
      <RealtimeRefresh />

      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Tickets</h1>
        {data && (
          <span className="text-sm text-slate-500">
            {data.total} total
            {closedCount > 0 ? ` · ${closedCount} closed` : ""}
          </span>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <div className="font-medium">Failed to load tickets</div>
          <div className="mt-1 text-red-700">{error}</div>
          <div className="mt-2 text-xs text-red-600">
            Is the API running at{" "}
            {process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}?
          </div>
        </div>
      )}

      {data && (
        <>
          <FiltersBar users={users} />
          <KanbanBoard tickets={data.tickets} users={users} />
        </>
      )}
    </div>
  );
}
