import { createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";
import { db } from "../db.js";
import { ApiError } from "../errors.js";

function tokenHash(token: string) {
  return createHash("sha256").update(`${config.SESSION_PEPPER}:${token}`).digest("hex");
}

export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    if (config.NODE_ENV !== "production" && config.ALLOW_DEV_AUTH === "true") {
      const devUserId = req.header("x-dev-user-id");
      if (devUserId) {
        const user = await db.user.findUnique({ where: { id: devUserId }, select: { id: true, role: true } });
        if (user) req.auth = { userId: user.id, role: user.role };
        next();
        return;
      }
    }

    const walletToken = req.cookies?.mbo_wallet_session;
    if (walletToken) {
      const walletSession = await db.walletSession.findUnique({
        where: { tokenHash: tokenHash(walletToken) },
        include: { user: { select: { id: true, role: true } }, wallet: { select: { id: true, address: true } } },
      });
      if (walletSession && !walletSession.revokedAt && walletSession.expiresAt > new Date()) {
        req.auth = {
          userId: walletSession.user.id,
          role: walletSession.user.role,
          walletId: walletSession.wallet.id,
          walletAddress: walletSession.wallet.address,
        };
      }
    }
    const bearer = req.header("authorization")?.match(/^Bearer (.+)$/i)?.[1];
    const token = bearer ?? req.cookies?.mbo_session;
    if (!token) {
      next();
      return;
    }

    const session = await db.session.findUnique({
      where: { tokenHash: tokenHash(token) },
      include: { user: { select: { id: true, role: true } } },
    });
    if (session && session.expiresAt > new Date()) {
      if (!req.auth) req.auth = { userId: session.user.id, role: session.user.role };
    }
    next();
  } catch (error) {
    next(error);
  }
}

export function requireWalletAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth?.walletId || !req.auth.walletAddress) {
    next(new ApiError(401, "WALLET_AUTH_REQUIRED", "Sign in with the wallet that owns this Mask Born."));
    return;
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) {
    next(new ApiError(401, "AUTH_REQUIRED", "Connect your X account to continue."));
    return;
  }
  next();
}

export async function requireVerifiedDiscord(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) {
    next(new ApiError(401, "AUTH_REQUIRED", "Create a profile and link Discord to continue."));
    return;
  }
  try {
    const discord = await db.socialAccount.findFirst({
      where: {
        userId: req.auth.userId,
        provider: "DISCORD",
        verificationState: "VERIFIED",
      },
      select: { id: true },
    });
    if (!discord) {
      next(new ApiError(403, "DISCORD_REQUIRED", "Link and verify a Discord account to continue."));
      return;
    }
    if (req.auth.role !== "ADMIN") {
      const accountRestriction = await db.voteRestriction.findFirst({
        where: {
          userId: req.auth.userId,
          type: "ACCOUNT",
          liftedAt: null,
          expiresAt: { gt: new Date() },
        },
        orderBy: { expiresAt: "desc" },
        select: { expiresAt: true },
      });
      if (accountRestriction) {
        next(new ApiError(403, "ACCOUNT_RESTRICTED", "This account is temporarily restricted from site actions.", {
          expiresAt: accountRestriction.expiresAt,
        }));
        return;
      }
    }
    next();
  } catch (error) {
    next(error);
  }
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) {
    next(new ApiError(401, "AUTH_REQUIRED", "Sign in to continue."));
    return;
  }
  if (req.auth.role !== "ADMIN") {
    next(new ApiError(403, "ADMIN_REQUIRED", "This action is limited to administrators."));
    return;
  }
  next();
}
