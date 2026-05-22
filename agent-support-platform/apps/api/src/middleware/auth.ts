import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export type UserRole = "admin" | "engineering" | "operations" | "support";

export interface AuthUser {
  userId?: string;
  email: string;
  name?: string;
  role?: UserRole;
}

// Express types augmentation — adds req.user once the middleware runs.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

// Verifies the Bearer JWT against NEXTAUTH_SECRET (HS256). On success,
// attaches the decoded user to req.user. On failure, returns 401.
//
// Skip when DISABLE_AUTH=true — useful when running the API standalone
// without the dashboard (e.g., local pipeline tests).
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (process.env.DISABLE_AUTH === "true") {
    return next();
  }

  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    console.error("✗ requireAuth: NEXTAUTH_SECRET is not set");
    return res.status(500).json({ error: "Server misconfigured" });
  }

  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or malformed Authorization header" });
  }

  const token = header.slice("Bearer ".length);
  try {
    const decoded = jwt.verify(token, secret, { algorithms: ["HS256"] }) as Record<string, unknown>;
    if (!decoded.email) {
      return res.status(401).json({ error: "Token missing email claim" });
    }
    req.user = {
      userId: decoded.userId as string | undefined,
      email: decoded.email as string,
      name: decoded.name as string | undefined,
      role: decoded.role as UserRole | undefined,
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

// Role-based gate that must be applied AFTER requireAuth.
// Example: router.delete("/admin/...", requireAuth, requireRole("admin"), handler)
export function requireRole(...allowed: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (process.env.DISABLE_AUTH === "true") return next();
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }
    if (!req.user.role || !allowed.includes(req.user.role)) {
      return res.status(403).json({
        error: `Role '${req.user.role}' is not authorized for this action`,
      });
    }
    next();
  };
}
