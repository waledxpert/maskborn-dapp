import "dotenv/config";
import { z } from "zod";

const optionalAddress = z.preprocess(
  (value) => value === "" ? undefined : value,
  z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
);

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  FRONTEND_URL: z.string().url().default("http://localhost:3000"),
  BACKEND_PUBLIC_URL: z.string().url().default("http://localhost:4000"),
  DATABASE_URL: z.string().min(1),
  SESSION_PEPPER: z.string().min(16).default("development-session-pepper-change-me"),
  SIGNAL_PEPPER: z.string().min(16).default("development-signal-pepper-change-me"),
  DISCORD_CLIENT_ID: z.string().optional(),
  DISCORD_CLIENT_SECRET: z.string().optional(),
  DISCORD_CALLBACK_URL: z.string().url().optional(),
  ADMIN_DISCORD_IDS: z.string().default(""),
  ALLOW_DEV_AUTH: z.enum(["true", "false"]).default("false"),
  STORAGE_LOCAL_DIR: z.string().min(1).default(".local-storage"),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_PRIVATE_BUCKET: z.string().optional(),
  R2_PUBLIC_BUCKET: z.string().optional(),
  R2_PUBLIC_BASE_URL: z.string().url().optional(),
  ARC_RPC_URL: z.string().url().default("https://rpc.testnet.arc.network"),
  ARC_CHAIN_ID: z.coerce.number().int().positive().default(5042002),
  ARC_DEPLOYMENT_BLOCK: z.coerce.number().int().nonnegative().default(0),
  MASKBORN_CONTRACT_ADDRESS: optionalAddress,
  MASKBORN_NAMES_ADDRESS: optionalAddress,
}).superRefine((value, ctx) => {
  const r2Values = [
    value.R2_ACCOUNT_ID,
    value.R2_ACCESS_KEY_ID,
    value.R2_SECRET_ACCESS_KEY,
    value.R2_PRIVATE_BUCKET,
    value.R2_PUBLIC_BUCKET,
    value.R2_PUBLIC_BASE_URL,
  ];
  const configured = r2Values.filter(Boolean).length;
  if (configured > 0 && configured !== r2Values.length) {
    ctx.addIssue({
      code: "custom",
      message: "Configure every R2 variable or leave all of them empty for local object storage.",
      path: ["R2_ACCOUNT_ID"],
    });
  }
  if (value.NODE_ENV === "production" && configured !== r2Values.length) {
    ctx.addIssue({
      code: "custom",
      message: "R2 object storage is required in production.",
      path: ["R2_ACCOUNT_ID"],
    });
  }
  if (value.DISCORD_CALLBACK_URL) {
    const callback = new URL(value.DISCORD_CALLBACK_URL);
    const expectedOrigin = new URL(
      value.NODE_ENV === "production" ? value.FRONTEND_URL : value.BACKEND_PUBLIC_URL,
    ).origin;
    if (callback.origin !== expectedOrigin || callback.pathname !== "/api/auth/discord/callback") {
      ctx.addIssue({
        code: "custom",
        message: `DISCORD_CALLBACK_URL must use ${value.NODE_ENV === "production" ? "FRONTEND_URL" : "BACKEND_PUBLIC_URL"} and end with /api/auth/discord/callback.`,
        path: ["DISCORD_CALLBACK_URL"],
      });
    }
  }
});

export const config = schema.parse(process.env);

export const adminDiscordIds = new Set(
  config.ADMIN_DISCORD_IDS.split(",").map((value) => value.trim()).filter(Boolean),
);
