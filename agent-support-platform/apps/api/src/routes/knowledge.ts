import { Router, Request, Response } from "express";
import { prisma } from "../services/database";
import { requireRole } from "../middleware/auth";

const router = Router();

// ─── GET /api/knowledge ─────────────────────────────────────
// List knowledge articles. Filterable by ?status=(draft|active|archived).

router.get("/", async (req: Request, res: Response) => {
  const { status } = req.query;

  const where: { status?: "draft" | "active" | "archived" } = {};
  if (status === "draft" || status === "active" || status === "archived") {
    where.status = status;
  }

  const articles = await prisma.knowledgeArticle.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      problemDescription: true,
      resolutionText: true,
      category: true,
      productArea: true,
      tags: true,
      status: true,
      usageCount: true,
      successCount: true,
      failureCount: true,
      sourceTicketIds: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  res.json({ articles });
});

// ─── GET /api/knowledge/:id ────────────────────────────────

router.get("/:id", async (req: Request, res: Response) => {
  const article = await prisma.knowledgeArticle.findUnique({
    where: { id: req.params.id },
  });
  if (!article) return res.status(404).json({ error: "Article not found" });
  res.json(article);
});

// ─── PATCH /api/knowledge/:id ──────────────────────────────
// Edit a draft or active article. Restricted to admin / operations /
// engineering — editing KB content shapes what every operator sees, so
// it shouldn't be open to every signed-in user (approval is the
// support lead's job; editing is content stewardship).

router.patch("/:id", requireRole("admin", "operations", "engineering"), async (req: Request, res: Response) => {
  const { title, problemDescription, resolutionText, tags, category, productArea } =
    req.body;
  const data: Record<string, unknown> = {};
  if (typeof title === "string") data.title = title.trim();
  if (typeof problemDescription === "string")
    data.problemDescription = problemDescription.trim();
  if (typeof resolutionText === "string") {
    data.resolutionText = resolutionText.trim();
    data.resolutionTextShort =
      resolutionText.length > 480 ? resolutionText.slice(0, 477) + "…" : resolutionText.trim();
  }
  if (Array.isArray(tags)) data.tags = tags;
  if (typeof category === "string") data.category = category;
  if (typeof productArea === "string" || productArea === null)
    data.productArea = productArea;

  const article = await prisma.knowledgeArticle.update({
    where: { id: req.params.id },
    data,
  });
  res.json(article);
});

// ─── POST /api/knowledge/:id/approve ───────────────────────
// Promote a draft to active. Only admins or support leads.

router.post(
  "/:id/approve",
  requireRole("admin", "support", "operations"),
  async (req: Request, res: Response) => {
    const article = await prisma.knowledgeArticle.update({
      where: { id: req.params.id },
      data: { status: "active" },
    });
    res.json(article);
  }
);

// ─── POST /api/knowledge/:id/archive ───────────────────────
// Take a (likely stale) article out of circulation.

router.post(
  "/:id/archive",
  requireRole("admin", "support", "operations"),
  async (req: Request, res: Response) => {
    const article = await prisma.knowledgeArticle.update({
      where: { id: req.params.id },
      data: { status: "archived" },
    });
    res.json(article);
  }
);

export { router as knowledgeRouter };
