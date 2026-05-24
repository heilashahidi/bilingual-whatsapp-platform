import { Router, Request, Response } from "express";
import { prisma } from "../services/database";

const router = Router();

// Intentionally unauthenticated — NextAuth's signIn callback hits this
// before a session exists, to allowlist the email. Returns id/name/email/role
// only (no PII). The `email` param narrows the result for that lookup.
router.get("/", async (req: Request, res: Response) => {
  const { email } = req.query;
  const where = email && typeof email === "string"
    ? { email: { equals: email, mode: "insensitive" as const } }
    : {};

  const users = await prisma.internalUser.findMany({
    where,
    orderBy: { name: "asc" },
    select: { id: true, name: true, email: true, role: true },
  });
  res.json({ users });
});

export { router as userRouter };
