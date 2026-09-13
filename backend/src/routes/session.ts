import { Router } from "express";
import { db } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncRoute } from "../utils.js";

export const sessionRouter = Router();

sessionRouter.get("/session", requireAuth, asyncRoute(async (req, res) => {
  const user = await db.user.findUniqueOrThrow({
    where: { id: req.auth!.userId },
    select: {
      id: true,
      role: true,
      displayName: true,
      avatarUrl: true,
      socialAccounts: {
        where: { provider: { in: ["X_MANUAL", "DISCORD"] } },
        select: { provider: true, username: true, verificationState: true },
      },
      wallets: { orderBy: { isPrimary: "desc" }, select: { id: true, chain: true, address: true, isPrimary: true, verifiedAt: true } },
    },
  });
  res.json({ user });
}));

sessionRouter.get("/profile", requireAuth, asyncRoute(async (req, res) => {
  const userId = req.auth!.userId;
  const [user, submissions, drafts, restrictions] = await db.$transaction([
    db.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        wallets: true,
        socialAccounts: { where: { provider: "X_MANUAL" } },
      },
    }),
    db.submission.findMany({
      where: { userId },
      orderBy: { publishedAt: "desc" },
      include: { galleryEntry: { include: { feeShare: true } } },
    }),
    db.draft.findMany({ where: { userId }, orderBy: { updatedAt: "desc" } }),
    db.voteRestriction.findMany({
      where: { userId, liftedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { expiresAt: "desc" },
    }),
  ]);

  const allowedTraitCategories = ["BACKGROUND", "EYES", "HATS", "SPECIAL"];
  const usedTraitCategories = [...new Set(
    submissions
      .filter((item) => item.kind === "TRAIT_EXTENSION")
      .flatMap((item) => item.categories),
  )].filter((category) => allowedTraitCategories.includes(category));
  const slots = {
    oneOfOne: {
      limit: 2,
      consumed: submissions.filter((item) => item.kind === "ONE_OF_ONE").length,
    },
    traits: {
      limitPerCategory: 1,
      allowedCategories: allowedTraitCategories,
      usedCategories: usedTraitCategories,
    },
  };
  res.json({ user, submissions, drafts, restrictions, slots });
}));
