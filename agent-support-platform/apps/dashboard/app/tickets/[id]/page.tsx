import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchTicket, fetchUsers } from "@/lib/api";
import { getServerApiToken } from "@/lib/auth-server";
import { RealtimeRefresh } from "@/lib/realtime-refresh";
import { TicketDetailView } from "./_components/ticket-detail";

export const dynamic = "force-dynamic";

// Dynamic browser tab title — shows the ticket's first inbound message
// (truncated) instead of the static "Nclusion". Helps operators
// distinguish multiple ticket tabs at a glance.
export async function generateMetadata({
  params,
}: {
  params: { id: string };
}): Promise<Metadata> {
  try {
    const token = await getServerApiToken();
    const ticket = await fetchTicket(params.id, token);
    const firstInbound = ticket.messages.find((m) => m.direction === "inbound");
    const snippet = (firstInbound?.translatedText ||
      firstInbound?.originalText ||
      ticket.category)
      .replace(/\s+/g, " ")
      .trim();
    const short = snippet.length > 60 ? snippet.slice(0, 57) + "…" : snippet;
    return { title: `${short} · #${ticket.id.slice(0, 8)} · Nclusion` };
  } catch {
    return { title: "Ticket · Nclusion" };
  }
}

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
