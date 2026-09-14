import { parseUnits } from "viem";
import { config } from "../../config.js";

const ELIGIBLE_ACTIONS = [
  "AWAKEN",
  "SET_EXECUTION_PAUSED",
  "UPDATE_AGENT_URI",
  "GRANT_CHECKPOINT_SESSION",
  "REVOKE_CHECKPOINT_SESSION",
] as const;

export function readSponsorshipPolicy() {
  const bundlerReady = config.AGENT_BUNDLER_PROVIDER !== "disabled" && Boolean(config.AGENT_BUNDLER_RPC_URL);
  const paymasterReady = config.AGENT_PAYMASTER_PROVIDER !== "disabled";
  const requested = config.AGENT_SPONSORSHIP_ENABLED === "true";
  const enabled = requested && bundlerReady && paymasterReady;
  const disabledReason = enabled ? null
    : !requested ? "SPONSORSHIP_NOT_ENABLED"
      : !bundlerReady ? "BUNDLER_NOT_CONFIGURED"
        : !paymasterReady ? "PAYMASTER_NOT_CONFIGURED"
          : "SPONSORSHIP_UNAVAILABLE";

  return {
    enabled,
    disabledReason,
    currency: "USDC",
    gasAsset: "native-USDC",
    dailyAllowance: config.AGENT_SPONSOR_DAILY_USDC_PER_TOKEN,
    dailyAllowanceBaseUnits: parseUnits(config.AGENT_SPONSOR_DAILY_USDC_PER_TOKEN, 18).toString(),
    dailyTransactionLimit: config.AGENT_SPONSOR_DAILY_TX_PER_TOKEN,
    reservationTtlSeconds: config.AGENT_SPONSOR_RESERVATION_TTL_SECONDS,
    eligibleActions: [...ELIGIBLE_ACTIONS],
    excludedActions: ["SEND_NATIVE_USDC"],
    bundlerProvider: config.AGENT_BUNDLER_PROVIDER,
    paymasterProvider: config.AGENT_PAYMASTER_PROVIDER,
    accountingMode: "reservation-required",
    settlementMode: "receipt-reconciled",
    notes: [
      "The model never receives a spending key.",
      "Sponsored gas is limited to reviewed account operations, not arbitrary transfers.",
      "A future reservation must bind chain, account, token, nonce, action, and UserOperation hash before paymaster approval.",
    ],
  };
}
