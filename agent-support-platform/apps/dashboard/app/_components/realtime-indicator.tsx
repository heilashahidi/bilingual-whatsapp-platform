"use client";

import { useEffect, useState } from "react";
import { getSocket } from "@/lib/socket";

// Nav-bar badge for the Socket.IO connection. Without it, a dropped
// connection silently stops realtime updates with no operator signal.
type ConnState = "live" | "reconnecting" | "offline";

export function RealtimeIndicator() {
  const [state, setState] = useState<ConnState>("reconnecting");

  useEffect(() => {
    const socket = getSocket();

    // `reconnect_failed` flips us to hard offline when the client gives up.
    const onConnect = () => setState("live");
    const onDisconnect = () => setState("reconnecting");
    const onReconnectFailed = () => setState("offline");

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.io.on("reconnect_failed", onReconnectFailed);
    socket.io.on("reconnect", onConnect);
    socket.io.on("reconnect_attempt", () => setState("reconnecting"));

    // Sync in case events already fired before we subscribed.
    setState(socket.connected ? "live" : "reconnecting");

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.io.off("reconnect_failed", onReconnectFailed);
      socket.io.off("reconnect", onConnect);
    };
  }, []);

  const styles: Record<ConnState, { dot: string; label: string; text: string }> = {
    live: { dot: "bg-emerald-500", label: "Live", text: "text-emerald-700" },
    reconnecting: {
      dot: "bg-amber-500 animate-pulse",
      label: "Reconnecting…",
      text: "text-amber-700",
    },
    offline: { dot: "bg-rose-500", label: "Offline", text: "text-rose-700" },
  };

  const s = styles[state];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full bg-slate-50 px-2 py-1 text-[11px] font-medium ring-1 ring-slate-200 ${s.text}`}
      title={
        state === "live"
          ? "Realtime connection healthy"
          : state === "reconnecting"
            ? "Trying to reconnect to the realtime channel — new tickets may not appear until this clears"
            : "Realtime connection lost — refresh the page to retry"
      }
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} aria-hidden />
      {s.label}
    </span>
  );
}
