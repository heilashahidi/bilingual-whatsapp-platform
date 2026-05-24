import { io, Socket } from "socket.io-client";
import type { TicketEventKind } from "@asp/shared";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(API_URL, {
      transports: ["websocket", "polling"],
      autoConnect: true,
    });
  }
  return socket;
}

export type TicketChangedEvent = {
  kind: TicketEventKind;
  ticketId: string;
};
