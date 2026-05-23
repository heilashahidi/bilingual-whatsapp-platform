/**
 * One-off backfill: for inbound messages already detected as English,
 * make translatedText equal to originalText so the dashboard's
 * `showSecondary = secondary !== primary` check hides the redundant
 * "translated" line on existing rows. This fixes UI rendering for
 * messages persisted BEFORE the pipeline started skipping Claude on
 * English input (commit ed8969e).
 *
 * Scope:
 *   - direction = 'inbound'   (NEVER touch outbound — the foreign-
 *                              language translatedText there is the
 *                              real translation sent to the agent)
 *   - originalLanguage = 'en' (we trust the detected language)
 *   - translatedText IS NOT NULL
 *   - translatedText != originalText (skip rows already in sync)
 *
 * Idempotent — re-running does nothing once the rows are in sync.
 *
 * Run locally against the dev DB:
 *   pnpm --filter @asp/api exec tsx scripts/backfill-english-translations.ts
 *
 * Run against production Neon:
 *   DATABASE_URL='<neon-pooled-url>' \
 *     pnpm --filter @asp/api exec tsx scripts/backfill-english-translations.ts
 *
 * Or via Railway:
 *   railway run --service api npx tsx scripts/backfill-english-translations.ts
 */

import { PrismaClient } from "@prisma/client";

async function main() {
  const prisma = new PrismaClient();

  // Count first so we can print a meaningful before/after.
  const candidates = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count
    FROM "Message"
    WHERE "direction" = 'inbound'
      AND "originalLanguage" = 'en'
      AND "translatedText" IS NOT NULL
      AND "translatedText" <> "originalText"
  `;
  const willUpdate = Number(candidates[0]?.count ?? 0);

  if (willUpdate === 0) {
    console.log("✓ Nothing to backfill — all inbound English messages are already in sync.");
    await prisma.$disconnect();
    return;
  }

  console.log(`→ Backfilling ${willUpdate} inbound English message(s)…`);

  const result = await prisma.$executeRaw`
    UPDATE "Message"
    SET "translatedText" = "originalText"
    WHERE "direction" = 'inbound'
      AND "originalLanguage" = 'en'
      AND "translatedText" IS NOT NULL
      AND "translatedText" <> "originalText"
  `;

  console.log(`✓ Updated ${result} row(s).`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("✗ Backfill failed:", err);
  process.exit(1);
});
