import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { config } from "./config.js";
import { errorHandler, notFound } from "./errors.js";
import { optionalAuth } from "./middleware/auth.js";
import { requestContext } from "./middleware/request-context.js";
import { adminRouter } from "./routes/admin.js";
import { applicationsRouter } from "./routes/applications.js";
import { authRouter } from "./routes/auth.js";
import { draftsRouter } from "./routes/drafts.js";
import { publicRouter } from "./routes/public.js";
import { sessionRouter } from "./routes/session.js";
import { submissionsRouter } from "./routes/submissions.js";
import { votesRouter } from "./routes/votes.js";
import { agentsRouter } from "./modules/agents/router.js";
import { walletAuthRouter } from "./modules/wallet-auth/router.js";
import { notificationsRouter } from "./modules/notifications/router.js";
import { assistantRouter } from "./modules/assistant/router.js";
import { intelligenceRouter } from "./modules/intelligence/router.js";
import { paydayRouter } from "./modules/payday/router.js";

export const app = express();

app.set("trust proxy", 1);
app.use(requestContext);
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({ origin: config.FRONTEND_URL, credentials: true }));
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());
app.use(rateLimit({
  windowMs: 60_000,
  limit: 180,
  standardHeaders: "draft-8",
  legacyHeaders: false,
}));
app.use(optionalAuth);

app.use("/api", publicRouter);
app.use("/api", authRouter);
app.use("/api", sessionRouter);
app.use("/api", applicationsRouter);
app.use("/api", draftsRouter);
app.use("/api", submissionsRouter);
app.use("/api", votesRouter);
app.use("/api", walletAuthRouter);
app.use("/api", agentsRouter);
app.use("/api", notificationsRouter);
app.use("/api", assistantRouter);
app.use("/api", intelligenceRouter);
app.use("/api", paydayRouter);
app.use("/api/mboadmin", adminRouter);

app.use(notFound);
app.use(errorHandler);
