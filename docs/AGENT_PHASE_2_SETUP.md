# Agent Phase 2: awakening setup

This slice adds a real onchain awakening path while keeping every value-moving action holder-confirmed. V2 supports checkpoint-only ERC-4337 UserOperations. It does **not** enable autonomous spending, session-key transfers, or live paymaster-sponsored gas yet.

## What is implemented

- One immutable Mask Born -> ERC-6551 account -> ERC-8004 identity binding.
- Deterministic account address before deployment.
- Atomic account creation and identity registration in one holder transaction.
- Dynamic authority: control follows the current Mask Born owner.
- ERC-1271 signature validation and current ERC-6551 interfaces.
- CALL-only execution, with the collection, identity registry, awakening registry, and the account itself blocked as generic targets.
- Immediate owner pause/unpause and a dedicated ERC-8004 discovery-URI update.
- Deterministic trait-derived constitution document and onchain hash.
- Backend-prepared and Arc-simulated calldata; the server never signs or submits it.
- A two-step frontend review and wallet confirmation flow.
- Public ERC-8004 registration files at `/.well-known/agent-registration/maskborn/{tokenId}.json`.
- Public Mask Born discovery profiles at `/.well-known/agent-card/maskborn/{tokenId}.json`; these honestly report A2A and x402 as disabled.
- Durable action records scoped to the holder's current ownership period, with independent sender/target/calldata/value and receipt reconciliation.
- Owner controls for pause/unpause, ERC-8004 URI updates, and native-USDC sends from the token-bound account.
- V2 checkpoint-session grants, inspection, and immediate revocation. Sessions can publish monitor-observation, report-digest, or liveness hashes only; they have no external-call or asset-transfer function.
- ERC-4337 v0.9 validation for those checkpoint calls only. Public discovery reports the EntryPoint, nonce, checkpoint-only scope, Pimlico bundler readiness, and sponsorship as disabled.
- A holder-facing Phase 2 readiness panel on `/agents` checks wallet sign-in, collection/index state, token selection, awakening, ERC-4337 checkpoint support, live bundler reachability, and the intentionally disabled sponsorship state.
- A deterministic holder briefing endpoint at `/api/agents/tokens/:tokenId/briefing` summarizes wallet/account USDC, awakening, checkpoint support, monitor counts, checkpoint-ready notifications, sponsorship status, submitter status and suggested next steps even when the external AI model is disabled.
- `/api/agents/sponsorship/status` exposes the disabled-mode sponsored-gas policy: `0.25` native USDC per token per day, `25` sponsored transactions per day, `180` second reservation TTL, and the current V2 allowlist of `PUBLISH_CHECKPOINT` only. Owner-control actions still require the holder wallet.
- Sponsorship reservations now have database storage, per-token/day budget reads at `/api/agents/tokens/:tokenId/sponsorship/budget`, and a guarded reservation endpoint at `/api/agents/actions/:actionId/sponsorship/reserve`. Because V2 sponsorship is checkpoint-only, owner-control action reservations return `ACTION_NOT_SPONSORABLE`. A checkpoint preflight endpoint now exists at `/api/agents/tokens/:tokenId/sponsorship/checkpoint/preflight`; it validates owner, awakened account, EntryPoint, checkpoint session, category, payload hash, nonce and daily budget, then returns callData plus sponsorship blockers. Monitor rules can also opt into checkpoint preflight by storing a checkpoint session-key address. When a matching USDC payment is observed, the worker hashes a deterministic monitor-observation payload and writes a `MONITOR_CHECKPOINT_READY` notification with the payload hash, callData, nonce and blockers. The `/agents` UI shows the holder budget card after awakened-token selection and ownership index catch-up, and the agent worker expires stale reservations on every tick. `/api/agents/paymaster/status` reports provider readiness; the paymaster client supports `pm_sponsorUserOperation` with an optional sponsorship policy ID but is not called while the paymaster provider/RPC are disabled.

## Current Arc testnet deployment

- `MaskBornAccountV2`: `0x0ba4f061a27f3Bb199Ff82b8fD512F2913CC3066`
- `MaskBornAgentRegistry`: `0x7cE327DCd5148e2eA268595d804CA75b85C63326`
- `EntryPoint v0.9`: `0x433709009B8330FDa32311DF1C2AFA402eD8D009`
- Deployment blocks: `62025198` and `62025200`
- Smoke account for token `1`: `0x7Ffdedc044290B3E3FAd5527d551081674E4E8Bb`
- Direct EntryPoint smoke UserOperation hash: `0xb212dda4e89f6c340a87eb74e7c1026c391f72d7358ad94a9e04ffe179ee67f2`
- Successful direct `handleOps` tx: `0x650681695c79c29e3db50f2375306c2f9da464bf2834c734e611c9d85c329a5f`
- Pimlico managed-bundler UserOperation hash: `0xa240b1707178511bfa87b62a5363229612fdb1a68df78213509286d880aa7afa`
- Pimlico EntryPoint tx: `0x9edec7413acce9815564829b221882745c21cb3fcc1b823a011d9a6e725cff8b`
- Final smoke cleanup: latest session revoked, total checkpoint calls `2`, UserOperation nonce `2`, EntryPoint deposit `0`, account balance `0`
- Versioned record: `arcOne/contracts/deployed-agents-arcTestnet.json`

Contract source lives only in `arcOne/contracts/src/agent`. The app does not contain a second Solidity copy.

After any Solidity interface change, compile the contracts and refresh the generated app ABIs from the `maskborn` root:

```powershell
npm run sync:agent-contracts
```

## 1. Verify dependencies again

From `C:\Users\Hp\Desktop\arcOne\contracts`:

```powershell
$rpc = "https://rpc.testnet.arc.network"
$erc6551 = "0x000000006551c19487814612e58FE06813775758"
$erc8004 = "0x8004A818BFB912233c491871b3d84c89A494BD9e"

& "$env:USERPROFILE\.foundry\bin\cast.exe" chain-id --rpc-url $rpc
& "$env:USERPROFILE\.foundry\bin\cast.exe" code $erc6551 --rpc-url $rpc
& "$env:USERPROFILE\.foundry\bin\cast.exe" code $erc8004 --rpc-url $rpc
& "$env:USERPROFILE\.foundry\bin\cast.exe" call $erc8004 "register(string)(uint256)" "data:application/json;base64,e30=" --from 0x000000000000000000000000000000000000BEEF --rpc-url $rpc
```

Expected: chain ID `5042002`, non-empty code for both addresses, and a numeric result from the final read-only simulation.

## 2. Test and dry-run the contracts

```powershell
& "$env:USERPROFILE\.foundry\bin\forge.exe" test
& "$env:USERPROFILE\.foundry\bin\forge.exe" script script/DeployAgents.s.sol --rpc-url arcTestnet -vvvv
```

The second command is a simulation because it omits `--broadcast`.

Set these values in `arcOne/contracts/.env` before the dry run:

```dotenv
PRIVATE_KEY=<testnet deployer key; never commit this>
TOKEN=<canonical Mask Born testnet collection>
```

## 3. Deploy only after reviewing the simulation

```powershell
& "$env:USERPROFILE\.foundry\bin\forge.exe" script script/DeployAgents.s.sol --rpc-url arcTestnet --broadcast -vvvv
```

Record the printed `MaskBornAccountV2` and `MaskBornAgentRegistry` addresses in a versioned deployment manifest. Deployment is not an upgrade to the NFT contract and does not alter existing tokens or art.

The script now deploys V2. If the earlier V1 registry was deployed but no token awakened, replace the application registry address with the reviewed V2 deployment. If any token already awakened on V1, do not imply that changing an ABI upgrades it: its immutable account and ERC-8004 identity remain on V1 until an explicit migration design exists.

## 4. Configure the application

In `maskborn/backend/.env`:

```dotenv
MASKBORN_AGENT_REGISTRY_ADDRESS=<printed MaskBornAgentRegistry address>
AGENT_PUBLIC_ORIGIN=https://<permanent-public-frontend-domain>
AGENT_MAX_OWNER_SEND_USDC=1000
AGENT_BUNDLER_PROVIDER=disabled
AGENT_BUNDLER_RPC_URL=
AGENT_PAYMASTER_PROVIDER=disabled
AGENT_CHECKPOINT_SIGNER_PRIVATE_KEY=
AGENT_CHECKPOINT_AUTOSUBMIT=false
INTELLIGENCE_X402_MODE=disabled
INTELLIGENCE_PUBLIC_PRICE_USDC=0.10
INTELLIGENCE_HOLDER_PRICE_USDC=0.02
INTELLIGENCE_RECEIVER_ADDRESS=
```

`AGENT_PUBLIC_ORIGIN` becomes part of permanent onchain identity metadata. Do not use `localhost`, a preview deployment URL, or a domain you do not control for a public testnet awakening.

Restart the backend and frontend after changing environment variables. The agent monitor worker can continue running independently.

Apply the new `AgentAction` table and regenerate the Prisma client before starting the API:

```powershell
cd C:\Users\Hp\Desktop\maskborn\backend
npx prisma db push
npx prisma generate
```

`AGENT_MAX_OWNER_SEND_USDC` is a backend/UI preparation guardrail, not an onchain spending policy. The current owner can still call the account contract directly; enforceable delegation limits arrive with scoped account permissions.

`AGENT_CHECKPOINT_SIGNER_PRIVATE_KEY` is optional and must be a disposable session key that was already granted through the holder wallet. It is not the holder wallet key. When unset, the app can preflight checkpoint UserOperations but cannot submit them. `AGENT_CHECKPOINT_AUTOSUBMIT=true` lets the worker submit monitor checkpoints automatically after a match, but only through the checkpoint-only session route.

`INTELLIGENCE_X402_MODE=disabled` keeps the paid-report flow in safe test mode: holder-authenticated quotes are created as already available, so the product path can be tested without live x402 payment verification. `live` mode must not be enabled until a receiver address, facilitator verification and entitlement reconciliation are reviewed.

## 5. Holder test

1. Open `/agents`, sign in with the wallet holding a revealed Mask Born, and select it.
2. Choose **Prepare awakening**. The backend rechecks ownership and simulates the exact transaction.
3. Verify Arc Testnet, the predicted account, `0 USDC` value, and the gas estimate.
4. Choose **Confirm in wallet** and inspect the wallet transaction before signing.
5. Wait for confirmation, refresh the token, and verify that the UI shows its ERC-8004 agent ID and ERC-6551 account.
6. Open both well-known JSON URLs and verify the registration, identity, account, and explicitly disabled protocol flags.
7. Fund only a disposable test account, then test pause, unpause, URI update, and a tiny USDC transfer. Confirm each action appears in the current-holder history with the correct Arcscan transaction.
8. Change one reviewed field in a local/API test and confirm reconciliation rejects the mismatched transaction.
9. Transfer a test NFT to another wallet and confirm the old owner cannot execute while the new owner can and cannot see the prior ownership period's action history.
10. Grant a disposable checkpoint key for one hour and two calls; publish two test hashes and verify the third call fails.
11. Verify pause blocks the key, revocation is immediate, and transferring the NFT to another address makes the granting-owner check fail.

## Important safety boundary

Never transfer the controlling Mask Born NFT into its own token-bound account. The account disables authorization if that direct ownership cycle occurs, but an unsafe ERC-721 `transferFrom` can still trap the NFT permanently because the existing collection has no transfer hook for the account registry.

Do not fund accounts with meaningful value until the transfer tests, pause recovery, receipt reconciliation, external review, and selected ERC-4337/paymaster compatibility work are complete. Prepared-action expiry is an application review window, not an onchain deadline; always inspect the wallet transaction itself.

## Next Phase 2 slice

The direct EntryPoint smoke and Pimlico managed-bundler smoke are complete for token `1`: awaken, checkpoint UserOperations, revoke, deposit withdrawal, and account sweep all verified. The `/agents` page now includes a browser-smoke checklist and deterministic briefing card so the holder test can be performed from the UI. The app now exposes managed-bundler readiness separately from EntryPoint support. Keep `AGENT_PAYMASTER_PROVIDER=disabled` until a real Arc paymaster/sponsorship path is selected and concurrency-safe budget accounting is implemented. The policy surface, budget ledger, checkpoint preflight, monitor-triggered checkpoint-ready notifications, session-key checkpoint submitter and assistant context exist. Paymaster signing remains disabled until a provider-backed authorization path is reviewed.

Checkpoint-ready inbox alerts now show the payload hash, session key, nonce and sponsorship state. A holder can click **Submit checkpoint** from the alert when the backend has the matching disposable `AGENT_CHECKPOINT_SIGNER_PRIVATE_KEY` configured. If the signer is missing or mismatched, the endpoint returns a setup blocker and no transaction is submitted.

The x402 intelligence skeleton is also available from `/agents`: it exposes a catalog, holder-rate quote, entitlement and report generation flow for collection health, wallet activity, USDC stream, agent profile and checkpoint summaries. These reports are wallet-authenticated and token-owner protected in the current build; public paid reports wait for live x402 verification.



