import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchTicket, fetchUsers } from "@/lib/api";
import { getServerApiToken } from "@/lib/auth-server";
import { RealtimeRefresh } from "@/lib/realtime-refresh";
import { TicketDetailView } from "./_components/ticket-detail";

export const dynamic = "force-dynamic";

export default async function TicketDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const token = await getServerApiToken();
  let ticket;
  try {
    ticket = await fetchTicket(params.id, token);
  } catch (e) {
    if (e instanceof Error && e.message.includes("404")) {
      notFound();
    }
    throw e;
  }
  const users = await fetchUsers(token).catch(() => []);

  return (
    <div className="mx-auto max-w-7xl">
      <RealtimeRefresh ticketId={ticket.id} />
      <div className="mb-3">
        <Link
          href="/tickets"
          className="text-sm text-slate-500 hover:text-slate-900"
        >
          ← All tickets
        </Link>
      </div>
      <TicketDetailView ticket={ticket} users={users} />
    </div>
  );
}
