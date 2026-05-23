/**
 * Demo seed: ~7 knowledge-base articles covering the most common
 * support patterns across HT / DO / CD so the /knowledge tab has
 * something to look at during a demo.
 *
 * Mix:
 *   - 4 active articles  (already approved, look like established docs)
 *   - 3 draft articles   (pending operator review — demoes the
 *     "incident resolves → kb-drafter writes article → operator
 *     approves" workflow without needing a live Claude run)
 *
 * The draft articles deliberately reference existing demo-* tickets
 * by externalId so the /knowledge "Derived from #abc12345" link
 * lands on a real ticket when seed-demo-tickets has been run first.
 * (If those tickets don't exist yet the article still seeds — the
 * sourceTicketIds field just shows stale UUIDs in that case.)
 *
 * Idempotent: keyed by article title. Re-running skips any article
 * whose title is already in the DB.
 *
 * Production run:
 *   railway run --service api npx tsx ../../scripts/seed-kb-articles.ts
 *
 * Local run:
 *   DATABASE_URL='<url>' pnpm --filter @asp/api exec tsx scripts/seed-kb-articles.ts
 */

import {
  PrismaClient,
  type ArticleStatus,
  type TicketCategory,
} from "@prisma/client";

const prisma = new PrismaClient();

interface SeedArticle {
  title: string;
  problemDescription: string;
  resolutionText: string;
  resolutionTextShort: string;
  category: TicketCategory;
  productArea: string;
  tags: string[];
  status: ArticleStatus;
  // Optional — used to populate sourceTicketIds. Looked up by the
  // first message's whatsappMessageId (set by seed-demo-tickets.ts).
  sourceTicketExternalIds?: string[];
  // Optional usage metrics so active articles look "lived in".
  usageCount?: number;
  successCount?: number;
  failureCount?: number;
}

const ARTICLES: SeedArticle[] = [
  // ─── Active articles ────────────────────────────────────────
  {
    title: "POS terminal frozen — power cycle and backup swap",
    problemDescription:
      "Branch POS terminal hangs on the home screen or stops responding to taps. A normal restart from the menu doesn't recover it.",
    resolutionText:
      "1. Hold the power button for 15 seconds to force a hard power cycle. Wait 30 seconds before powering back on.\n" +
      "2. If the screen comes back, run a test transaction for 1 HTG / 1 DOP / 100 CDF to confirm it's processing.\n" +
      "3. If it stays frozen, switch to the branch's backup terminal and continue serving customers. Mark the dead terminal with the dispatch sticker.\n" +
      "4. Open a hardware ticket from the dashboard with the terminal serial number. Logistics will dispatch a replacement within 48 hours.\n" +
      "5. Once the replacement arrives, return the dead unit in the same shipping box using the prepaid label.",
    resolutionTextShort:
      "Hard power cycle: hold power 15s, wait 30s, power on. If still frozen, swap to backup terminal and open a hardware ticket with the serial number. Replacement dispatched within 48h.",
    category: "operational_complaint",
    productArea: "hardware",
    tags: ["pos_terminal", "hardware", "power_cycle", "replacement"],
    status: "active",
    usageCount: 23,
    successCount: 20,
    failureCount: 1,
  },
  {
    title: "App login fails with 'incorrect password' after Android update",
    problemDescription:
      "Agent enters the correct password and gets 'incorrect password' repeatedly. Started after a recent Android system update.",
    resolutionText:
      "1. Have the agent tap 'Mwen bliye modpas mwen' / 'I forgot my password' on the login screen and request a reset code.\n" +
      "2. The reset code arrives via SMS within 2 minutes. If it doesn't, ask them to check the phone number on file in the team admin tool.\n" +
      "3. Once they set a new password, log in with the new credentials.\n" +
      "4. If login still fails after the reset, clear the app cache: long-press the app icon → App info → Storage → Clear cache (NOT clear data — that wipes their offline queue).\n" +
      "5. If the issue persists after a cache clear, escalate to engineering — there's a known Android 14 keystore bug affecting < 0.5% of devices.",
    resolutionTextShort:
      "Use 'Forgot password' on the login screen for SMS reset code. If still failing after reset, clear app cache (NOT clear data). Persistent failures = Android 14 keystore bug, escalate.",
    category: "bug_report",
    productArea: "mobile_app",
    tags: ["login", "android", "password_reset", "keystore"],
    status: "active",
    usageCount: 18,
    successCount: 15,
    failureCount: 2,
  },
  {
    title: "Balance discrepancy between app and cash book",
    problemDescription:
      "Agent reports the balance shown in the app doesn't match their physical cash book. Difference is usually consistent across transactions for the day.",
    resolutionText:
      "1. Ask the agent for the exact discrepancy amount and the time it first appeared. Note both.\n" +
      "2. Pull the agent's transaction log from the dashboard (Tickets → Agent profile → Transactions today).\n" +
      "3. Look for any transactions marked 'pending sync' — those are completed on the phone but not yet posted to the ledger. They explain most app/book mismatches.\n" +
      "4. If there are pending-sync transactions, ask the agent to open the app, pull-to-refresh on the home screen, and wait 60 seconds. The balance should re-sync.\n" +
      "5. If the discrepancy survives a sync, escalate to finance with the agent ID and discrepancy amount — they'll run a reconciliation.",
    resolutionTextShort:
      "Most cases are pending-sync transactions. Ask agent to pull-to-refresh on home screen and wait 60s. If discrepancy persists after sync, escalate to finance with agent ID + amount.",
    category: "operational_complaint",
    productArea: "account",
    tags: ["balance", "reconciliation", "sync", "ledger"],
    status: "active",
    usageCount: 11,
    successCount: 10,
    failureCount: 0,
  },
  {
    title: "Add a new employee to an agent account",
    problemDescription:
      "Agent owner wants to add a new staff member to their account so they can serve customers under the same branch.",
    resolutionText:
      "1. The agent owner opens the app and goes to Settings → Team → Add Employee.\n" +
      "2. They enter the new employee's phone number (must be unique — not already linked to another agent).\n" +
      "3. The new employee receives an SMS with an enrollment link. They tap it within 24 hours to complete setup.\n" +
      "4. Once enrolled, the new employee can log in with their own credentials. The owner can adjust their permissions from the Team screen.\n" +
      "5. To remove an employee later, the owner uses Settings → Team → tap on the name → Remove from team.",
    resolutionTextShort:
      "Owner: Settings → Team → Add Employee → enter unique phone number. New employee gets SMS enrollment link, valid 24h. Manage permissions or remove later from same Team screen.",
    category: "question",
    productArea: "account",
    tags: ["team", "onboarding", "permissions"],
    status: "active",
    usageCount: 9,
    successCount: 9,
    failureCount: 0,
  },

  // ─── Draft articles (pending operator review) ───────────────
  {
    title: "Withdrawals section crashes app on iOS 17.4",
    problemDescription:
      "App force-closes whenever the agent taps the Withdrawals tab. Started after the agent's phone auto-updated to iOS 17.4 overnight.",
    resolutionText:
      "1. Confirm the iOS version with the agent: Settings → General → About → Software Version.\n" +
      "2. If they're on 17.4, ask them to update to 17.4.1 (released this week with the WebKit fix) via Settings → General → Software Update.\n" +
      "3. After the OS update, ask them to force-quit and reopen the app. The Withdrawals tab should load.\n" +
      "4. If they can't update (low storage / slow connection), have them use the web dashboard for withdrawals as a workaround until the next app release.\n" +
      "5. We're shipping app v3.8.2 next week with the WebKit workaround built in — once installed, the 17.4 issue is fully resolved.",
    resolutionTextShort:
      "iOS 17.4 + Withdrawals tab = crash. Have agent update to iOS 17.4.1 (Settings → General → Software Update). Workaround: use web dashboard. App v3.8.2 next week fixes natively.",
    category: "bug_report",
    productArea: "mobile_app",
    tags: ["app_crash", "ios", "withdrawals", "ios_17_4"],
    status: "draft",
    sourceTicketExternalIds: ["demo-es-1-msg-0"],
  },
  {
    title: "Receipt printer prints letters cut off at the edges",
    problemDescription:
      "Branch receipt printer outputs receipts where the right edge of each line is clipped. Digital receipts are unaffected.",
    resolutionText:
      "1. Reassure the agent: digital receipts are legally valid in all three regions, so they can keep serving customers without paper receipts in the meantime.\n" +
      "2. Open a hardware ticket with the printer serial number (on the underside of the unit). Specify 'cut-off print head' in the description.\n" +
      "3. Logistics will ship a replacement print head within 5 business days — it's a swap, no technician visit needed.\n" +
      "4. When the new head arrives: power off the printer, pop open the lid, slide the old head out, slide the new one in, close the lid, power back on.\n" +
      "5. Print a test receipt from the dashboard (Settings → Hardware → Test print) to confirm the new head is aligned correctly.",
    resolutionTextShort:
      "Digital receipts are legally valid — agent can keep operating. Open hardware ticket with printer serial for replacement print head (5 biz days). Swap is self-service, no technician needed.",
    category: "operational_complaint",
    productArea: "hardware",
    tags: ["printer", "receipts", "hardware", "print_head"],
    status: "draft",
    sourceTicketExternalIds: ["demo-es-3-msg-0"],
  },
  {
    title: "App is slow — transactions take over two minutes",
    problemDescription:
      "Agent reports every transaction takes more than two minutes to validate. Customers are leaving the branch before they can complete service.",
    resolutionText:
      "1. Confirm whether the slowness affects one branch or several — check the Incidents page for an active network cluster in the same country.\n" +
      "2. Ask the agent to run a connectivity test from the app: Settings → Diagnostics → Network test. The test reports latency to our edge.\n" +
      "3. If latency is > 800ms, it's a mobile-network issue, not an app issue. Tell the agent to switch to Wi-Fi if available, or restart their phone's data connection (Airplane mode on/off).\n" +
      "4. If latency is normal (< 300ms) but transactions are slow, restart the app and try again. If still slow, escalate — could be a backend issue affecting more agents.\n" +
      "5. While they wait, the offline-queue feature still works: transactions complete on-device and sync when the network recovers, so customers can be served.",
    resolutionTextShort:
      "Run Settings → Diagnostics → Network test. >800ms = mobile network, switch to Wi-Fi or toggle airplane mode. <300ms = backend, escalate. Offline queue keeps transactions working in the meantime.",
    category: "operational_complaint",
    productArea: "mobile_app",
    tags: ["slow", "network", "connectivity", "offline_queue"],
    status: "draft",
    sourceTicketExternalIds: ["demo-fr-1-msg-0"],
  },
];

async function lookupSourceTicketIds(
  externalIds: string[] | undefined
): Promise<string[]> {
  if (!externalIds || externalIds.length === 0) return [];
  const messages = await prisma.message.findMany({
    where: { whatsappMessageId: { in: externalIds } },
    select: { ticketId: true },
  });
  return Array.from(new Set(messages.map((m) => m.ticketId)));
}

async function main() {
  console.log(`Seeding ${ARTICLES.length} demo KB articles…`);

  let created = 0;
  let skipped = 0;

  for (const a of ARTICLES) {
    const existing = await prisma.knowledgeArticle.findFirst({
      where: { title: a.title },
    });
    if (existing) {
      skipped += 1;
      continue;
    }

    const sourceTicketIds = await lookupSourceTicketIds(
      a.sourceTicketExternalIds
    );

    await prisma.knowledgeArticle.create({
      data: {
        title: a.title,
        problemDescription: a.problemDescription,
        resolutionText: a.resolutionText,
        resolutionTextShort: a.resolutionTextShort,
        category: a.category,
        productArea: a.productArea,
        tags: a.tags,
        sourceTicketIds,
        status: a.status,
        usageCount: a.usageCount ?? 0,
        successCount: a.successCount ?? 0,
        failureCount: a.failureCount ?? 0,
      },
    });

    console.log(
      `  ✓ ${a.status.padEnd(6)} ${a.title.slice(0, 70)}${a.title.length > 70 ? "…" : ""}`
    );
    created += 1;
  }

  console.log(
    `\n✓ Created ${created} new article(s)${skipped ? `, skipped ${skipped} that already existed` : ""}.`
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("✗ KB article seed failed:", err);
  process.exit(1);
});
