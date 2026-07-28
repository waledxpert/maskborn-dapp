import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export function notFound(req: Request, _res: Response, next: NextFunction) {
  next(new ApiError(404, "ROUTE_NOT_FOUND", `No route for ${req.method} ${req.path}.`));
}

export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction) {
  if (error instanceof ZodError) {
    const first = error.issues[0];
    const field = first?.path.length ? first.path.join(".") : "request";
    res.status(422).json({
      error: {
        code: "VALIDATION_ERROR",
        message: first ? `${field}: ${first.message}` : "The request data is invalid.",
        fields: error.flatten().fieldErrors,
        issues: error.issues,
        requestId: req.id,
      },
    });
    return;
  }

  if (error instanceof ApiError) {
    res.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
        requestId: req.id,
      },
    });
    return;
  }

  const prismaError = error as {
    code?: unknown;
    meta?: { target?: unknown; constraint?: unknown };
  };
  if (typeof prismaError?.code === "string") {
    const target = JSON.stringify(prismaError.meta?.target ?? prismaError.meta?.constraint ?? "");
    const hasTargetFields = (...fields: string[]) => fields.every((field) => target.includes(field));
    if (prismaError.code === "P2002") {
      const accessoryName = hasTargetFields("category", "normalizedName");
      const xUsername = hasTargetFields("claimKey");
      const submissionTitle = hasTargetFields("titleClaim");
      const knownDuplicate = hasTargetFields("chain", "normalized")
        ? ["WALLET_ALREADY_CLAIMED", "That wallet is already attached to another profile."]
        : hasTargetFields("quotePost")
          ? ["QUOTE_POST_ALREADY_USED", "That X quote post has already been submitted."]
          : hasTargetFields("provider", "providerAccountId")
            ? ["SOCIAL_ACCOUNT_ALREADY_LINKED", "That social account is already linked to a Mask Born profile."]
            : hasTargetFields("userId", "mediaHash") || hasTargetFields("pixelDataKey") || hasTargetFields("previewAssetKey")
              ? ["ARTWORK_ALREADY_SUBMITTED", "This artwork has already been submitted by this account."]
              : hasTargetFields("submissionId", "userId", "categoryKey")
                ? ["VOTE_UPDATE_CONFLICT", "That vote was updated at the same time. Reload and try again."]
                : hasTargetFields("draftId", "version")
                  ? ["DRAFT_CONFLICT", "A newer draft revision already exists. Reload before saving again."]
                  : hasTargetFields("tokenChainId", "tokenContract", "tokenId")
                    ? ["ONCHAIN_TOKEN_ALREADY_REGISTERED", "That on-chain token is already registered in the gallery."]
                    : hasTargetFields("chainId", "txHash", "logIndex")
                      ? ["TRADING_EVENT_ALREADY_INDEXED", "That on-chain trading event has already been indexed."]
                      : hasTargetFields("tradeFeeEventId", "feeShareId")
                        ? ["ACCRUAL_ALREADY_RECORDED", "That creator fee accrual has already been recorded."]
                        : hasTargetFields("accrualId")
                          ? ["PAYOUT_ITEM_EXISTS", "That creator accrual is already attached to a payout."]
                          : hasTargetFields("galleryEntryId")
                            ? ["FEE_SHARE_EXISTS", "That gallery item already has a creator fee share."]
                            : hasTargetFields("submissionId")
                              ? ["GALLERY_ENTRY_EXISTS", "That submission is already in the gallery."]
                              : hasTargetFields("userId", "scope", "key")
                                ? ["REQUEST_ALREADY_PROCESSING", "That request is already being processed. Wait a moment and reload."]
                                : hasTargetFields("userId")
                                  ? ["APPLICATION_ALREADY_SUBMITTED", "This profile has already submitted its application."]
                                  : hasTargetFields("slug")
                                    ? ["SUBMISSION_SLUG_CONFLICT", "That submission address was just taken. Publish again to generate a new one."]
                                    : hasTargetFields("tokenHash")
                                      ? ["SESSION_TOKEN_CONFLICT", "A secure session could not be created. Please try signing in again."]
                                      : null;
      res.status(409).json({
        error: {
          code: accessoryName
            ? "ACCESSORY_NAME_TAKEN"
            : xUsername
              ? "X_USERNAME_TAKEN"
              : submissionTitle
                ? "SUBMISSION_TITLE_TAKEN"
                : knownDuplicate?.[0] ?? "DUPLICATE_RESOURCE",
          message: accessoryName
            ? "That accessory name was just taken. Choose another name and publish again."
            : xUsername
              ? "That X username is already linked to a Mask Born account."
              : submissionTitle
                ? "That artwork title is already in use. Choose a different title."
                : knownDuplicate?.[1] ?? "An identical record already exists.",
          details: { target: prismaError.meta?.target },
          requestId: req.id,
        },
      });
      return;
    }
    if (prismaError.code === "P2003") {
      res.status(409).json({
        error: {
          code: "RELATED_RECORD_MISSING",
          message: "A related record changed before this action completed. Reload and try again.",
          details: { constraint: prismaError.meta?.constraint },
          requestId: req.id,
        },
      });
      return;
    }
    if (prismaError.code === "P2034") {
      res.status(409).json({
        error: {
          code: "WRITE_CONFLICT",
          message: "Another update happened at the same time. Please try this action again.",
          requestId: req.id,
        },
      });
      return;
    }
    if (prismaError.code === "P2025") {
      res.status(404).json({
        error: {
          code: "RECORD_NOT_FOUND",
          message: "The record for this action no longer exists.",
          requestId: req.id,
        },
      });
      return;
    }
    if (prismaError.code === "P2021") {
      res.status(503).json({
        error: {
          code: "DATABASE_SCHEMA_OUTDATED",
          message: "The database schema is not ready for this feature. Apply the latest Prisma schema and retry.",
          requestId: req.id,
        },
      });
      return;
    }
  }

  console.error(`[${req.id}]`, error);
  res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "The request could not be completed.",
      requestId: req.id,
    },
  });
}
