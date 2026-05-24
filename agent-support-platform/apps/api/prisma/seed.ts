import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  // ─── Branches ──────────────────────────────────────────────
  const branches = await Promise.all([
    prisma.branch.create({
      data: { name: "Port-au-Prince Central", country: "HT", region: "ouest", latitude: 18.5944, longitude: -72.3074 },
    }),
    prisma.branch.create({
      data: { name: "Cap-Haïtien", country: "HT", region: "nord", latitude: 19.7578, longitude: -72.2044 },
    }),
    prisma.branch.create({
      data: { name: "Santo Domingo Centro", country: "DO", region: "distrito_nacional", latitude: 18.4861, longitude: -69.9312 },
    }),
    prisma.branch.create({
      data: { name: "Santiago de los Caballeros", country: "DO", region: "cibao", latitude: 19.4517, longitude: -70.6970 },
    }),
    prisma.branch.create({
      data: { name: "Kinshasa Central", country: "CD", region: "kinshasa", latitude: -4.4419, longitude: 15.2663 },
    }),
    prisma.branch.create({
      data: { name: "Lubumbashi", country: "CD", region: "haut_katanga", latitude: -11.6647, longitude: 27.4794 },
    }),
  ]);

  console.log(`✓ Created ${branches.length} branches`);

  // ─── Test Agents ───────────────────────────────────────────
  const agents = await Promise.all([
    prisma.agent.create({
      data: {
        phoneNumber: "+50937001001",
        name: "Jean-Baptiste Pierre",
        country: "HT",
        preferredLanguage: "ht",
        branchId: branches[0].id,
      },
    }),
    prisma.agent.create({
      data: {
        phoneNumber: "+50937001002",
        name: "Marie Claire Duclos",
        country: "HT",
        preferredLanguage: "ht",
        branchId: branches[1].id,
      },
    }),
    prisma.agent.create({
      data: {
        phoneNumber: "+18091234567",
        name: "Carlos Mendez",
        country: "DO",
        preferredLanguage: "es",
        branchId: branches[2].id,
      },
    }),
    prisma.agent.create({
      data: {
        phoneNumber: "+243812345678",
        name: "Emmanuel Kabongo",
        country: "CD",
        preferredLanguage: "fr",
        branchId: branches[4].id,
      },
    }),
  ]);

  console.log(`✓ Created ${agents.length} test agents`);

  // ─── Internal Users ────────────────────────────────────────
  const users = await Promise.all([
    prisma.internalUser.create({
      data: {
        name: "Admin User",
        email: "admin@example.com",
        role: "admin",
      },
    }),
    prisma.internalUser.create({
      data: {
        name: "Support Lead",
        email: "support@example.com",
        role: "support",
      },
    }),
    prisma.internalUser.create({
      data: {
        name: "Engineering Lead",
        email: "eng@example.com",
        role: "engineering",
      },
    }),
  ]);

  console.log(`✓ Created ${users.length} internal users`);

  // ─── Sample Tickets ────────────────────────────────────────
  const now = Date.now();
  const minsAgo = (m: number) => new Date(now - m * 60 * 1000);
  const minsAhead = (m: number) => new Date(now + m * 60 * 1000);

  const tickets = await Promise.all([
    // Critical Haiti bug — fresh, unassigned
    prisma.ticket.create({
      data: {
        agentId: agents[0].id,
        status: "open",
        category: "bug_report",
        severity: "critical",
        productArea: "payments",
        tags: ["app_crash", "transaction_failure"],
        agentReportedAt: minsAgo(15),
        slaFirstResponseDeadline: minsAhead(75), // 1.5h extended Haiti SLA
        slaResolutionDeadline: minsAhead(330),
        createdAt: minsAgo(15),
        messages: {
          create: [
            {
              direction: "inbound",
              senderType: "agent",
              senderId: agents[0].id,
              originalText:
                "Aplikasyon an tonbe lè m ap eseye voye lajan. Mwen pèdi 3 transaksyon deja maten an.",
              originalLanguage: "ht",
              translatedText:
                "The app crashes when I try to send money. I've lost 3 transactions already this morning.",
              translationConfidence: 0.88,
              contentType: "text",
              agentTimestamp: minsAgo(15),
              serverReceivedAt: minsAgo(14),
              deliveryDelay: 60,
              whatsappMessageId: "STUB_HT_001",
              createdAt: minsAgo(14),
            },
          ],
        },
      },
    }),
    // High DR complaint — in progress with a US reply
    prisma.ticket.create({
      data: {
        agentId: agents[2].id,
        status: "in_progress",
        category: "operational_complaint",
        severity: "high",
        productArea: "lottery",
        tags: ["lottery_results", "slow_payout"],
        assignedTo: users[1].id,
        agentReportedAt: minsAgo(120),
        slaFirstResponseDeadline: minsAhead(60),
        slaResolutionDeadline: minsAhead(1320),
        createdAt: minsAgo(120),
        messages: {
          create: [
            {
              direction: "inbound",
              senderType: "agent",
              senderId: agents[2].id,
              originalText:
                "Los resultados de la lotería todavía no salen y la gente está enojada en mi tienda.",
              originalLanguage: "es",
              translatedText:
                "The lottery results still haven't come out and people are angry in my shop.",
              translationConfidence: 0.96,
              contentType: "text",
              agentTimestamp: minsAgo(120),
              serverReceivedAt: minsAgo(120),
              deliveryDelay: 0,
              whatsappMessageId: "STUB_DO_001",
              createdAt: minsAgo(120),
            },
            {
              direction: "outbound",
              senderType: "internal_user",
              senderId: users[1].id,
              originalText:
                "We're aware of the delay — operations team is investigating. Expecting publication within 30 minutes.",
              originalLanguage: "en",
              translatedText:
                "Estamos al tanto de la demora — el equipo de operaciones está investigando. Esperamos publicación en 30 minutos.",
              contentType: "text",
              whatsappMessageId: "STUB_DO_OUT_001",
              createdAt: minsAgo(90),
            },
          ],
        },
      },
    }),
    // Medium DRC question — waiting on agent
    prisma.ticket.create({
      data: {
        agentId: agents[3].id,
        status: "waiting_on_agent",
        category: "question",
        severity: "medium",
        productArea: "account",
        tags: ["password_reset"],
        agentReportedAt: minsAgo(240),
        slaFirstResponseDeadline: minsAhead(1800),
        slaResolutionDeadline: minsAhead(5400),
        createdAt: minsAgo(240),
        messages: {
          create: [
            {
              direction: "inbound",
              senderType: "agent",
              senderId: agents[3].id,
              originalText:
                "Bonjour, j'ai oublié mon mot de passe et je ne peux pas me connecter à l'app. Comment faire?",
              originalLanguage: "fr",
              translatedText:
                "Hello, I forgot my password and can't log in to the app. How do I reset it?",
              translationConfidence: 0.95,
              contentType: "text",
              agentTimestamp: minsAgo(240),
              serverReceivedAt: minsAgo(238),
              deliveryDelay: 120,
              whatsappMessageId: "STUB_CD_001",
              createdAt: minsAgo(238),
            },
          ],
        },
      },
    }),
  ]);

  console.log(`✓ Created ${tickets.length} sample tickets`);
  console.log("\nSeed complete! You can now start the server.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
