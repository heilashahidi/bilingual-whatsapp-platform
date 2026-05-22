import { Router, Request, Response } from "express";
import { IncidentStatus, Prisma } from "@prisma/client";
import { prisma } from "../services/database";

const router = Router();

const VALID_STATUSES = new Set<IncidentStatus>([
  "detected",
  "confirmed",
  "mitigating",
  "resolved",
]);

function parseStatus(v: unknown): IncidentStatus | undefined {
  return typeof v === "string" && VALID_STATUSES.has(v as IncidentStatus)
    ? (v as IncidentStatus)
    : undefined;
}

// ─── GET /api/incidents ─────────────────────────────────────────────
// List incidents, newest first. Filter by ?status= or ?country=.

router.get("/", async (req: Request, res: Response) => {
  const { status, country } = req.query;

  const where: Prisma.IncidentWhereInput = {};
  const parsedStatus = parseStatus(status);
  if (parsedStatus) where.status = parsedStatus;
  if (country === "HT" || country === "DO" || country === "CD") {
    where.affectedCountries = { has: country };
  }

  const incidents = await prisma.incident.findMany({
    where,
    orderBy: { detectedAt: "desc" },
    include: {
      _count: { select: { tickets: true } },
    },
  });

  res.json({
    incidents: incidents.map((i) => {
      const { _count, ...rest } = i;
      return { ...rest, ticketCount: _count.tickets };
    }),
  });
});

// ─── GET /api/incidents/:id ─────────────────────────────────────────
// Single incident with its contributing tickets (lightweight summary).

router.get("/:id", async (req: Request, res: Response) => {
  const incident = await prisma.incident.findUnique({
    where: { id: req.params.id },
    include: {
      tickets: {
        select: {
          id: true,
          severity: true,
          status: true,
          category: true,
          createdAt: true,
          agent: {
            select: {
              name: true,
              country: true,
              branch: { select: { name: true, region: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!incident) return res.status(404).json({ error: "Incident not found" });
  return res.json({ incident });
});

// ─── PATCH /api/incidents/:id ───────────────────────────────────────
// Update incident status / notes (operator action). Lightweight — full
// resolution workflow can be layered on later.

router.patch("/:id", async (req: Request, res: Response) => {
  const { status, rootCause, resolutionNotes } = req.body;

  const data: Prisma.IncidentUpdateInput = {};
  const parsedStatus = parseStatus(status);
  if (parsedStatus) {
    data.status = parsedStatus;
    if (parsedStatus === "resolved") data.resolvedAt = new Date();
  }
  if (typeof rootCause === "string") data.rootCause = rootCause;
  if (typeof resolutionNotes === "string") data.resolutionNotes = resolutionNotes;

  const incident = await prisma.incident.update({
    where: { id: req.params.id },
    data,
  });

  res.json({ incident });
});

export { router as incidentRouter };
