/**
 * One-off cleanup: soft-delete all tickets attached to the test agent
 * "Heila Shahidi" (Twilio Sandbox test number that auto-registered
 * during dev/demo). Uses the existing soft-delete pattern — sets
 * `deletedAt` so the dashboard hides the rows without losing data.
 *
 * To recover any of them, run an UPDATE … SET "deletedAt" = NULL
 * WHERE id = '…' against the same DB.
 *
 * Defaults to DRY RUN — prints what would be deleted without changing
 * anything. Pass DELETE=true to actually mutate the rows.
 *
 * Run against production Neon (via Railway-linked shell):
 *   railway run --service api npx tsx ../../scripts/delete-test-tickets.ts
 *
 * Then actually delete:
 *   railway run --service api DELETE=true npx tsx ../../scripts/delete-test-tickets.ts
 *
 * Run locally:
 *   DATABASE_URL='<url>' pnpm --filter @asp/api exec tsx scripts/delete-test-tickets.ts
 */

import { PrismaClient } from "@prisma/client";

const TARGET_AGENT_NAME = "Heila Shahidi";

async function main() {
  const prisma = new PrismaClient();
  const dryRun = process.env.DELETE !== "true";

  // Find candidate tickets — anything currently visible (not already
  // soft-deleted) attached to an agent whose name matches.
  const candidates = await prisma.ticket.findMany({
    where: {
      deletedAt: null,
      agent: { name: TARGET_AGENT_NAME },
    },
    select: {
      id: true,
      severity: true,
      category: true,
      status: true,
      createdAt: true,
      agent: { select: { name: true, phoneNumber: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  if (candidates.length === 0) {
    console.log(`✓ No tickets attached to "${TARGET_AGENT_NAME}" — nothing to delete.`);
    await prisma.$disconnect();
    return;
  }

  console.log(
    `${dryRun ? "DRY RUN — would soft-delete" : "Soft-deleting"} ${candidates.length} ticket(s) attached to "${TARGET_AGENT_NAME}":\n`
  );
  for (const t of candidates) {
    console.log(
      `  ${t.id.slice(0, 8)}  ${t.severity.padEnd(8)} ${t.category.padEnd(22)} ${t.status.padEnd(18)} ${t.createdAt.toISOString()}  ${t.agent.phoneNumber}`
    );
  }

  if (dryRun) {
    console.log(
      `\nTo actually delete these, re-run with DELETE=true:\n  railway run --service api DELETE=true npx tsx ../../scripts/delete-test-tickets.ts`
    );
    await prisma.$disconnect();
    return;
  }

  const result = await prisma.ticket.updateMany({
    where: {
      deletedAt: null,
      agent: { name: TARGET_AGENT_NAME },
    },
    data: {
      deletedAt: new Date(),
      // We don't have an InternalUser id for "the script" so leave
      // deletedBy null. The audit log will show the bulk delete as
      // script-initiated.
    },
  });

  console.log(`\n✓ Soft-deleted ${result.count} ticket(s).`);
  console.log(
    `  To recover: UPDATE "Ticket" SET "deletedAt" = NULL WHERE "agentId" IN (SELECT id FROM "Agent" WHERE name = '${TARGET_AGENT_NAME}');`
  );

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("✗ Cleanup failed:", err);
  process.exit(1);
});
