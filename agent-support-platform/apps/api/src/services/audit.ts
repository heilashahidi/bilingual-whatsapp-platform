import { prisma } from "./database";
import type { AuthUser } from "../middleware/auth";

// One small helper called from every mutation route. Fires and forgets:
// if the audit insert fails, the underlying mutation still succeeds.

export type AuditAction =
  | "ticket_created"
  | "status_changed"
  | "severity_changed"
  | "category_changed"
  | "assigned"
  | "unassigned"
  | "tagged"
  | "message_sent"
  | "note_added"
  | "resolved"
  | "deleted";

export function recordEvent(input: {
  ticketId: string;
  action: AuditAction;
  payload?: Record<string, unknown>;
  actor?: AuthUser | null;
}): void {
  prisma.event
    .create({
      data: {
        ticketId: input.ticketId,
        actorId: input.actor?.userId || null,
        actorEmail: input.actor?.email || null,
        action: input.action,
        payload: input.payload ? (input.payload as object) : undefined,
      },
    })
    .catch((err) =>
      console.error(`  ✗ audit log failed for ${input.action}:`, err)
    );
}
