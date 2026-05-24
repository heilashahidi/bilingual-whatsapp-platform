import { prisma } from "./database";
import type { AuthUser } from "../middleware/auth";
import type { AuditAction } from "@asp/shared";

export type { AuditAction };

// Fire-and-forget: if the audit insert fails, the underlying mutation
// still succeeds.

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
