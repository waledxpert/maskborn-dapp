import { createHash, randomBytes } from "node:crypto";
import { Router, type Response } from "express";
import { getAddress, type Hex } from "viem";
import { createSiweMessage, generateSiweNonce } from "viem/siwe";
import { config } from "../../config.js";
import { db } from "../../db.js";
import { ApiError } from "../../errors.js";
import { asyncRoute } from "../../utils.js";
import { arcClient } from "../chain/client.js";

export const walletAuthRouter = Router();
const challengeLifetimeMs = 10 * 60 * 1000;
const walletSessionLifetimeMs = 7 * 24 * 60 * 60 * 1000;
const hash = (value: string) => createHash("sha256").update(`${config.SESSION_PEPPER}:${value}`).digest("hex");
const cookieOptions = {
  httpOnly: true,
  secure: config.NODE_ENV === "production",
  sameSite: config.NODE_ENV === "production" ? "none" as const : "lax" as const,
  path: "/",
};

function setWalletCookie(res: Response, token: string) {
  res.cookie("mbo_wallet_session", token, { ...cookieOptions, maxAge: walletSessionLifetimeMs });
}

walletAuthRouter.post("/wallet/challenge", asyncRoute(async (req, res) => {
  let address;
  try { address = getAddress(String(req.body?.address ?? "")); }
  catch { throw new ApiError(422, "WALLET_INVALID", "Enter a valid EVM wallet address."); }
  const nonce = generateSiweNonce();
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + challengeLifetimeMs);
  const origin = new URL(config.FRONTEND_URL);
  const message = createSiweMessage({
    address,
    chainId: config.ARC_CHAIN_ID,
    domain: origin.host,
    uri: origin.origin,
    version: "1",
    nonce,
    issuedAt,
    expirationTime: expiresAt,
    statement: "Sign in to manage the Mask Born tokens owned by this wallet.",
  });
  const challenge = await db.walletChallenge.create({
    data: { address, normalized: address.toLowerCase(), chainId: config.ARC_CHAIN_ID, nonceHash: hash(nonce), messageHash: hash(message), expiresAt },
  });
  res.status(201).json({ challengeId: challenge.id, message, expiresAt });
}));

walletAuthRouter.post("/wallet/verify", asyncRoute(async (req, res) => {
  const challengeId = String(req.body?.challengeId ?? "");
  const message = String(req.body?.message ?? "");
  const signature = String(req.body?.signature ?? "") as Hex;
  const challenge = await db.walletChallenge.findUnique({ where: { id: challengeId } });
  if (!challenge || challenge.usedAt || challenge.expiresAt <= new Date()) {
    throw new ApiError(401, "WALLET_CHALLENGE_EXPIRED", "This wallet request expired. Start again.");
  }
  const nonce = message.match(/(?:^|\n)Nonce: ([A-Za-z0-9]+)(?:\n|$)/)?.[1];
  if (hash(message) !== challenge.messageHash || !nonce || hash(nonce) !== challenge.nonceHash || !/^0x[0-9a-fA-F]+$/.test(signature)) {
    throw new ApiError(401, "WALLET_SIGNATURE_INVALID", "The signed wallet request is invalid.");
  }
  const origin = new URL(config.FRONTEND_URL);
  const valid = await arcClient.verifySiweMessage({
    address: getAddress(challenge.address), domain: origin.host, nonce, message, signature, time: new Date(),
  }).catch(() => false);
  if (!valid) throw new ApiError(401, "WALLET_SIGNATURE_INVALID", "The wallet signature could not be verified.");

  const token = randomBytes(32).toString("base64url");
  const result = await db.$transaction(async (tx) => {
    const consumed = await tx.walletChallenge.updateMany({
      where: { id: challenge.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() },
    });
    if (consumed.count !== 1) throw new ApiError(409, "WALLET_CHALLENGE_USED", "This wallet request was already used.");
    const existing = await tx.wallet.findUnique({
      where: { chain_normalized: { chain: "EVM", normalized: challenge.normalized } },
    });
    if (existing && req.auth && existing.userId !== req.auth.userId) {
      throw new ApiError(409, "WALLET_ALREADY_CLAIMED", "That wallet is linked to another Mask Born profile.");
    }
    let userId = existing?.userId ?? req.auth?.userId;
    if (!userId) userId = (await tx.user.create({ data: { displayName: `${challenge.address.slice(0, 6)}…${challenge.address.slice(-4)}` } })).id;
    const wallet = existing ?? await tx.wallet.create({
      data: { userId, chain: "EVM", address: challenge.address, normalized: challenge.normalized, verifiedAt: new Date(), isPrimary: true },
    });
    if (existing && !existing.verifiedAt) {
      await tx.wallet.update({ where: { id: existing.id }, data: { verifiedAt: new Date(), address: challenge.address } });
    }
    await tx.walletSession.create({
      data: { userId, walletId: wallet.id, tokenHash: hash(token), expiresAt: new Date(Date.now() + walletSessionLifetimeMs) },
    });
    return { walletId: wallet.id, address: challenge.address };
  });
  setWalletCookie(res, token);
  res.json({ wallet: { id: result.walletId, address: result.address, chainId: config.ARC_CHAIN_ID, verified: true } });
}));

walletAuthRouter.post("/wallet/logout", asyncRoute(async (req, res) => {
  const token = req.cookies?.mbo_wallet_session;
  if (token) await db.walletSession.updateMany({ where: { tokenHash: hash(token), revokedAt: null }, data: { revokedAt: new Date() } });
  res.clearCookie("mbo_wallet_session", cookieOptions);
  res.status(204).end();
}));
