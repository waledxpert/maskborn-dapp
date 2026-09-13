# Agent Phase 2: awakening setup

This slice adds a real onchain awakening path while keeping every value-moving action holder-confirmed. It does **not** enable autonomous spending, session-key transfers, ERC-4337, a paymaster, or sponsored gas yet.

## What is implemented

- One immutable Mask Born → ERC-6551 account → ERC-8004 identity binding.
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

Record the printed `MaskBornAccountV1` and `MaskBornAgentRegistry` addresses in a versioned deployment manifest. Deployment is not an upgrade to the NFT contract and does not alter existing tokens or art.

## 4. Configure the application

In `maskborn/backend/.env`:

```dotenv
MASKBORN_AGENT_REGISTRY_ADDRESS=<printed MaskBornAgentRegistry address>
AGENT_PUBLIC_ORIGIN=https://<permanent-public-frontend-domain>
```

`AGENT_PUBLIC_ORIGIN` becomes part of permanent onchain identity metadata. Do not use `localhost`, a preview deployment URL, or a domain you do not control for a public testnet awakening.

Restart the backend and frontend after changing environment variables. The agent monitor worker can continue running independently.

## 5. Holder test

1. Open `/agents`, sign in with the wallet holding a revealed Mask Born, and select it.
2. Choose **Prepare awakening**. The backend rechecks ownership and simulates the exact transaction.
3. Verify Arc Testnet, the predicted account, `0 USDC` value, and the gas estimate.
4. Choose **Confirm in wallet** and inspect the wallet transaction before signing.
5. Wait for confirmation, refresh the token, and verify that the UI shows its ERC-8004 agent ID and ERC-6551 account.
6. Open `/.well-known/agent-registration/maskborn/{tokenId}.json` and verify the identity record.
7. Transfer a test NFT to another wallet and confirm the old owner cannot execute while the new owner can.

## Important safety boundary

Never transfer the controlling Mask Born NFT into its own token-bound account. The account disables authorization if that direct ownership cycle occurs, but an unsafe ERC-721 `transferFrom` can still trap the NFT permanently because the existing collection has no transfer hook for the account registry.

Do not fund accounts with meaningful value until the transfer tests, pause recovery, receipt reconciliation, external review, and selected ERC-4337/paymaster compatibility work are complete.

## Next Phase 2 slice

The next implementation slice is transaction receipt reconciliation plus the public Agent Card and owner control panel. After that comes scoped, non-value session permissions. ERC-4337 and sponsored gas remain last because they depend on a verified Arc bundler/paymaster combination and concurrency-safe budget accounting.
