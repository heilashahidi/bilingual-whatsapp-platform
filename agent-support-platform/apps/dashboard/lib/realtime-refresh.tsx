"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getSocket, type TicketChangedEvent } from "./socket";

/**
 * Subscribes to `ticket:changed` events and triggers a server-component refresh.
 *
 * - Without `ticketId`: refreshes on ANY ticket event (use on the list page).
 * - With `ticketId`: refreshes only when the event matches that ticket
 *   (use on the detail page to avoid unnecessary refreshes).
 *
 * `router.refresh()` re-runs server components against the current URL, so the
 * UI updates without a full page reload.
 */
export function RealtimeRefresh({ ticketId }: { ticketId?: string }) {
  const router = useRouter();

  useEffect(() => {
    const socket = getSocket();

    const handler = (event: TicketChangedEvent) => {
      if (ticketId && event.ticketId !== ticketId) return;
      router.refresh();
    };

    socket.on("ticket:changed", handler);
    return () => {
      socket.off("ticket:changed", handler);
    };
  }, [router, ticketId]);

  return null;
}
