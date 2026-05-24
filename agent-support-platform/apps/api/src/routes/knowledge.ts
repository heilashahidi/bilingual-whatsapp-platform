import { Router, Request, Response } from "express";
import { prisma } from "../services/database";
import { requireRole } from "../middleware/auth";

const router = Router();

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

router.get("/:id", async (req: Request, res: Response) => {
  const article = await prisma.knowledgeArticle.findUnique({
    where: { id: req.params.id },
  });
  if (!article) return res.status(404).json({ error: "Article not found" });
  res.json(article);
});

// Editing KB content shapes what every operator sees, so restrict to
// admin/operations/engineering. Approval (separate route) is the support
// lead's job.
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
