import type { Server as HttpServer } from "node:http";
import { Server as IOServer } from "socket.io";
import type { TicketEventKind } from "@asp/shared";

export type { TicketEventKind };

let io: IOServer | null = null;

export function initRealtime(httpServer: HttpServer): IOServer {
  io = new IOServer(httpServer, {
    cors: { origin: "*" },
  });

  io.on("connection", (socket) => {
    console.log(`  ⚡ realtime client connected: ${socket.id}`);
    socket.on("disconnect", () => {
      console.log(`  ⚡ realtime client disconnected: ${socket.id}`);
    });
  });

  return io;
}

export function emitTicketEvent(kind: TicketEventKind, ticketId: string): void {
  if (!io) return; // Server not initialized yet (e.g., during tests)
  io.emit("ticket:changed", { kind, ticketId });
}
