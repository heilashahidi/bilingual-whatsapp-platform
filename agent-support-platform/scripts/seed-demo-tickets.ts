/**
 * Demo seed: 12 additional tickets across Haitian Creole, French,
 * Spanish, and English with realistic agent messages, translations,
 * categories, and a few operator replies / internal notes.
 *
 * Use this to populate the dashboard with varied content for a demo
 * recording or screenshots — without resetting the existing seed.
 *
 * Idempotent: each ticket has a stable demo-* externalId; re-running
 * skips messages whose whatsappMessageId already exists.
 *
 * Production run:
 *   railway run --service api npx tsx ../../scripts/seed-demo-tickets.ts
 *
 * Local run:
 *   DATABASE_URL='<url>' pnpm --filter @asp/api exec tsx scripts/seed-demo-tickets.ts
 */

import {
  PrismaClient,
  type Country,
  type Language,
  type Severity,
  type TicketCategory,
  type MessageDirection,
} from "@prisma/client";

const prisma = new PrismaClient();

type Lang = Extract<Language, "ht" | "fr" | "es" | "en">;

interface DemoMessage {
  direction: MessageDirection;
  original: string;
  translated: string;  // English version (same as original when lang=en)
  language: Lang;
  // Minutes before "now" — used for chronological spread
  minutesAgo: number;
}

interface DemoTicket {
  externalIdPrefix: string;
  agentPhone: string;
  agentName: string;
  country: Country;
  language: Lang;
  branchName: string;
  branchRegion: string;
  category: TicketCategory;
  severity: Severity;
  tags: string[];
  productArea: string;
  messages: DemoMessage[];
  resolutionSummary?: string;
  status?: "open" | "in_progress" | "waiting_on_agent" | "resolved" | "closed";
  note?: string;
}

const DEMOS: DemoTicket[] = [
  // ─── Haitian Creole ─────────────────────────────────────────
  {
    externalIdPrefix: "demo-ht-1",
    agentPhone: "+50937001010",
    agentName: "Yvelyne Saint-Louis",
    country: "HT",
    language: "ht",
    branchName: "Jacmel Branch",
    branchRegion: "sud-est",
    category: "bug_report",
    severity: "high",
    tags: ["login", "android"],
    productArea: "mobile_app",
    messages: [
      {
        direction: "inbound",
        original: "Mwen pa ka konekte nan aplikasyon an. Mwen tape modpas mwen plizyè fwa men li di mwen modpas la pa kòrèk.",
        translated: "I can't log into the app. I've typed my password several times but it says the password is incorrect.",
        language: "ht",
        minutesAgo: 35,
      },
      {
        direction: "outbound",
        original: "We're looking into this. Can you try resetting your password from the login screen by tapping 'Mwen bliye modpas mwen'?",
        translated: "Nou ap gade sa. Èske ou ka eseye repwograme modpas ou nan ekran koneksyon an lè ou peze 'Mwen bliye modpas mwen'?",
        language: "ht",
        minutesAgo: 28,
      },
    ],
    status: "waiting_on_agent",
  },
  {
    externalIdPrefix: "demo-ht-2",
    agentPhone: "+50937001011",
    agentName: "Patrick Aristide",
    country: "HT",
    language: "ht",
    branchName: "Gonaïves Branch",
    branchRegion: "artibonite",
    category: "operational_complaint",
    severity: "critical",
    tags: ["transaction_failure", "money_lost"],
    productArea: "payments",
    messages: [
      {
        direction: "inbound",
        original: "Sis tranzaksyon depo te echwe maten an. Klyan yo ap tann e mwen pa ka eksplike yo kisa ki rive.",
        translated: "Six deposit transactions failed this morning. Customers are waiting and I can't explain to them what's happening.",
        language: "ht",
        minutesAgo: 12,
      },
    ],
    status: "open",
  },
  {
    externalIdPrefix: "demo-ht-3",
    agentPhone: "+50937001012",
    agentName: "Nathalie Etienne",
    country: "HT",
    language: "ht",
    branchName: "Port-au-Prince Central",
    branchRegion: "ouest",
    category: "question",
    severity: "low",
    tags: ["lottery"],
    productArea: "lottery",
    messages: [
      {
        direction: "inbound",
        original: "Bonjou, kilè rezilta lotri yo ap pibliye jodi a?",
        translated: "Hello, what time will the lottery results be published today?",
        language: "ht",
        minutesAgo: 95,
      },
      {
        direction: "outbound",
        original: "Results will be posted by 7 PM local time as usual. We'll notify you once they're live.",
        translated: "Rezilta yo ap poste jiska 7è diswa kòm dabitid. N ap fè ou konnen lè yo disponib.",
        language: "ht",
        minutesAgo: 88,
      },
    ],
    status: "resolved",
    resolutionSummary: "Confirmed standard 7 PM publishing time for lottery results.",
  },

  // ─── Spanish (Dominican Republic) ───────────────────────────
  {
    externalIdPrefix: "demo-es-1",
    agentPhone: "+18091234580",
    agentName: "Rosa María Fernández",
    country: "DO",
    language: "es",
    branchName: "La Romana Branch",
    branchRegion: "la_romana",
    category: "bug_report",
    severity: "high",
    tags: ["app_crash", "ios"],
    productArea: "mobile_app",
    messages: [
      {
        direction: "inbound",
        original: "La aplicación se cierra sola cada vez que intento abrir la sección de retiros. Llevo así desde esta mañana.",
        translated: "The app crashes every time I try to open the withdrawals section. It's been like this since this morning.",
        language: "es",
        minutesAgo: 50,
      },
    ],
    status: "in_progress",
    note: "Likely related to the iOS 17.4 push we saw issues with on @Carlos's ticket from yesterday. Investigating.",
  },
  {
    externalIdPrefix: "demo-es-2",
    agentPhone: "+18091234581",
    agentName: "Miguel Ángel Reyes",
    country: "DO",
    language: "es",
    branchName: "Santiago de los Caballeros",
    branchRegion: "cibao",
    category: "feature_request",
    severity: "low",
    tags: ["reporting", "ux"],
    productArea: "account",
    messages: [
      {
        direction: "inbound",
        original: "¿Sería posible agregar un reporte semanal de comisiones por sucursal? Lo necesitamos para los reportes a la gerencia.",
        translated: "Would it be possible to add a weekly commission report per branch? We need it for management reports.",
        language: "es",
        minutesAgo: 1440, // 1 day ago
      },
    ],
    status: "open",
  },
  {
    externalIdPrefix: "demo-es-3",
    agentPhone: "+18091234582",
    agentName: "Lucía Vargas",
    country: "DO",
    language: "es",
    branchName: "Santo Domingo Centro",
    branchRegion: "distrito_nacional",
    category: "operational_complaint",
    severity: "medium",
    tags: ["receipts", "printer"],
    productArea: "hardware",
    messages: [
      {
        direction: "inbound",
        original: "La impresora de recibos no está imprimiendo bien, salen las letras cortadas. ¿Puedo seguir operando sin recibos físicos?",
        translated: "The receipt printer isn't printing properly, letters come out cut off. Can I keep operating without physical receipts?",
        language: "es",
        minutesAgo: 180,
      },
      {
        direction: "outbound",
        original: "Yes, you can keep operating — digital receipts are valid. We'll dispatch a replacement printer head this week.",
        translated: "Sí, puede seguir operando — los recibos digitales son válidos. Enviaremos un cabezal de impresora de reemplazo esta semana.",
        language: "es",
        minutesAgo: 165,
      },
    ],
    status: "waiting_on_agent",
  },

  // ─── French (DRC) ───────────────────────────────────────────
  {
    externalIdPrefix: "demo-fr-1",
    agentPhone: "+243812345690",
    agentName: "Emmanuel Mukendi",
    country: "CD",
    language: "fr",
    branchName: "Goma Branch",
    branchRegion: "nord_kivu",
    category: "operational_complaint",
    severity: "high",
    tags: ["network", "connectivity"],
    productArea: "mobile_app",
    messages: [
      {
        direction: "inbound",
        original: "L'application est très lente aujourd'hui. Chaque transaction prend plus de deux minutes à se valider. Mes clients commencent à partir.",
        translated: "The app is very slow today. Every transaction takes more than two minutes to validate. My customers are starting to leave.",
        language: "fr",
        minutesAgo: 25,
      },
    ],
    status: "open",
  },
  {
    externalIdPrefix: "demo-fr-2",
    agentPhone: "+243812345691",
    agentName: "Sylvie Tshibanda",
    country: "CD",
    language: "fr",
    branchName: "Lubumbashi",
    branchRegion: "haut_katanga",
    category: "bug_report",
    severity: "critical",
    tags: ["balance", "discrepancy"],
    productArea: "account",
    messages: [
      {
        direction: "inbound",
        original: "Le solde affiché dans l'application ne correspond pas à mon livre de caisse. Il manque 45 000 francs.",
        translated: "The balance shown in the app doesn't match my cash book. There's 45,000 francs missing.",
        language: "fr",
        minutesAgo: 8,
      },
    ],
    status: "open",
  },
  {
    externalIdPrefix: "demo-fr-3",
    agentPhone: "+243812345692",
    agentName: "Jean-Claude Mbuyi",
    country: "CD",
    language: "fr",
    branchName: "Kinshasa Central",
    branchRegion: "kinshasa",
    category: "question",
    severity: "low",
    tags: ["training"],
    productArea: "other",
    messages: [
      {
        direction: "inbound",
        original: "Bonjour, comment puis-je ajouter un nouvel employé à mon compte agent ?",
        translated: "Hello, how can I add a new employee to my agent account?",
        language: "fr",
        minutesAgo: 220,
      },
      {
        direction: "outbound",
        original: "Go to Settings → Team → Add Employee, then enter their phone number. They'll receive an SMS to complete enrollment.",
        translated: "Allez dans Paramètres → Équipe → Ajouter un employé, puis saisissez son numéro de téléphone. Il recevra un SMS pour finaliser l'inscription.",
        language: "fr",
        minutesAgo: 200,
      },
    ],
    status: "resolved",
    resolutionSummary: "Walked agent through Settings → Team → Add Employee flow.",
  },

  // ─── English ────────────────────────────────────────────────
  {
    externalIdPrefix: "demo-en-1",
    agentPhone: "+18091234583",
    agentName: "Daniel Peña",
    country: "DO",
    language: "en",
    branchName: "Puerto Plata Branch",
    branchRegion: "puerto_plata",
    category: "bug_report",
    severity: "medium",
    tags: ["notifications", "push"],
    productArea: "mobile_app",
    messages: [
      {
        direction: "inbound",
        original: "I'm not getting push notifications for new deposits anymore. The badge counter still works but no sound or banner.",
        translated: "I'm not getting push notifications for new deposits anymore. The badge counter still works but no sound or banner.",
        language: "en",
        minutesAgo: 60,
      },
    ],
    status: "open",
  },
  {
    externalIdPrefix: "demo-en-2",
    agentPhone: "+50937001013",
    agentName: "Robert James",
    country: "HT",
    language: "en",
    branchName: "Cap-Haïtien",
    branchRegion: "nord",
    category: "operational_complaint",
    severity: "high",
    tags: ["pos_terminal", "hardware"],
    productArea: "hardware",
    messages: [
      {
        direction: "inbound",
        original: "POS terminal frozen at branch — restart didn't help. Customers are waiting in line and I can't process any payments.",
        translated: "POS terminal frozen at branch — restart didn't help. Customers are waiting in line and I can't process any payments.",
        language: "en",
        minutesAgo: 18,
      },
      {
        direction: "outbound",
        original: "Try holding the power button for 15 seconds for a full power cycle. If that doesn't work, swap to your backup terminal — I'll dispatch a replacement.",
        translated: "Try holding the power button for 15 seconds for a full power cycle. If that doesn't work, swap to your backup terminal — I'll dispatch a replacement.",
        language: "en",
        minutesAgo: 15,
      },
    ],
    status: "waiting_on_agent",
  },
  {
    externalIdPrefix: "demo-en-3",
    agentPhone: "+243812345693",
    agentName: "Grace Mwamba",
    country: "CD",
    language: "en",
    branchName: "Kinshasa Central",
    branchRegion: "kinshasa",
    category: "feature_request",
    severity: "low",
    tags: ["dashboard", "analytics"],
    productArea: "account",
    messages: [
      {
        direction: "inbound",
        original: "Can the daily summary email include a transaction count broken down by service type? Right now it's just one total.",
        translated: "Can the daily summary email include a transaction count broken down by service type? Right now it's just one total.",
        language: "en",
        minutesAgo: 2880, // 2 days ago
      },
    ],
    status: "open",
  },
];

// SLA defaults from packages/shared — replicated here to avoid the
// monorepo import path issue in standalone scripts.
const SLA_FIRST_RESPONSE_MINUTES: Record<Severity, number> = {
  critical: 15,
  high: 60,
  medium: 240,
  low: 1440,
};

async function ensureBranch(
  name: string,
  country: Country,
  region: string
): Promise<string> {
  const existing = await prisma.branch.findFirst({ where: { name } });
  if (existing) return existing.id;
  const created = await prisma.branch.create({
    data: { name, country, region },
  });
  return created.id;
}

async function ensureAgent(
  demo: DemoTicket,
  branchId: string
): Promise<string> {
  const existing = await prisma.agent.findUnique({
    where: { phoneNumber: demo.agentPhone },
  });
  if (existing) return existing.id;
  const created = await prisma.agent.create({
    data: {
      phoneNumber: demo.agentPhone,
      name: demo.agentName,
      country: demo.country,
      preferredLanguage: demo.language as Language,
      branchId,
    },
  });
  return created.id;
}

async function main() {
  console.log(`Seeding ${DEMOS.length} demo tickets…`);

  let created = 0;
  let skipped = 0;

  for (const demo of DEMOS) {
    const firstMessageId = `${demo.externalIdPrefix}-msg-0`;
    // Idempotency: if the first message already exists in the DB
    // (re-running the script), skip the whole ticket. This means
    // tweaking message text requires deleting the row first.
    const existingMsg = await prisma.message.findFirst({
      where: { whatsappMessageId: firstMessageId },
    });
    if (existingMsg) {
      skipped += 1;
      continue;
    }

    const branchId = await ensureBranch(
      demo.branchName,
      demo.country,
      demo.branchRegion
    );
    const agentId = await ensureAgent(demo, branchId);

    const now = Date.now();
    const firstReportedAt = new Date(now - demo.messages[0].minutesAgo * 60_000);
    const slaMinutes = SLA_FIRST_RESPONSE_MINUTES[demo.severity];
    const slaDeadline = new Date(firstReportedAt.getTime() + slaMinutes * 60_000);

    const ticket = await prisma.ticket.create({
      data: {
        agentId,
        status: demo.status ?? "open",
        category: demo.category,
        severity: demo.severity,
        productArea: demo.productArea,
        tags: demo.tags,
        agentReportedAt: firstReportedAt,
        slaFirstResponseDeadline: slaDeadline,
        // Mark first-response met if there's any outbound message
        slaFirstResponseMet: demo.messages.some((m) => m.direction === "outbound"),
        resolvedAt: demo.status === "resolved" ? new Date(now - 5 * 60_000) : null,
        resolutionSummary: demo.resolutionSummary ?? null,
      },
    });

    for (let i = 0; i < demo.messages.length; i++) {
      const m = demo.messages[i];
      const messageTimestamp = new Date(now - m.minutesAgo * 60_000);
      await prisma.message.create({
        data: {
          ticketId: ticket.id,
          direction: m.direction,
          senderType: m.direction === "inbound" ? "agent" : "internal_user",
          // No real senderId for the operator side in demo data —
          // matches the legacy seed pattern and the soft-deletable
          // shape the dashboard handles.
          senderId: null,
          originalText: m.original,
          originalLanguage: m.language as Language,
          translatedText: m.translated,
          translationConfidence: m.language === "en" ? 1.0 : 0.92,
          contentType: "text",
          whatsappMessageId: `${demo.externalIdPrefix}-msg-${i}`,
          agentTimestamp: messageTimestamp,
          serverReceivedAt: messageTimestamp,
        },
      });
    }

    if (demo.note) {
      await prisma.note.create({
        data: {
          ticketId: ticket.id,
          authorId: null, // system / script-authored
          text: demo.note,
          mentions: [],
        },
      });
    }

    console.log(
      `  ✓ ${ticket.id.slice(0, 8)} [${demo.severity}/${demo.category}] ${demo.language} · ${demo.agentName}`
    );
    created += 1;
  }

  console.log(
    `\n✓ Created ${created} new demo ticket(s)${skipped ? `, skipped ${skipped} that already existed` : ""}.`
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("✗ Demo seed failed:", err);
  process.exit(1);
});
