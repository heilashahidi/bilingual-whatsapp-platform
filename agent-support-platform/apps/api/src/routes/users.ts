import { Router, Request, Response } from "express";
import { prisma } from "../services/database";

const router = Router();

// ─── GET /api/users ─────────────────────────────────────────
// List internal users. Used by the assignee dropdown AND by NextAuth's
// signIn callback to verify an email is on the allowlist before issuing
// a session. The email query param narrows the result for that case.
//
// Intentionally unauthenticated — NextAuth has to call this before a
// session exists. Returns only id/name/email/role (no PII).

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
