import { Router, Request, Response } from "express";
import { prisma } from "../services/database";

const router = Router();

// ─── GET /api/users ─────────────────────────────────────────
// List internal users for the assignee dropdown.

router.get("/", async (_req: Request, res: Response) => {
  const users = await prisma.internalUser.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, email: true, role: true },
  });
  res.json({ users });
});

export { router as userRouter };
