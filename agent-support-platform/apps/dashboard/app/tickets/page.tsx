import { fetchTickets, fetchUsers } from "@/lib/api";
import { getServerApiToken } from "@/lib/auth-server";
import { RealtimeRefresh } from "@/lib/realtime-refresh";
import { TicketsShell } from "./_components/tickets-shell";

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

  if (error || !data) {
    return (
      <div className="space-y-4">
        <RealtimeRefresh />
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Tickets
        </h1>
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <div className="font-medium">Failed to load tickets</div>
          <div className="mt-1 text-rose-700">{error ?? "No data returned"}</div>
          <div className="mt-2 text-xs text-rose-600">
            Is the API running at {process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}?
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <RealtimeRefresh />
      <TicketsShell tickets={data.tickets} users={users} />
    </>
  );
}
