# Agent Phase 1 setup

The first implementation slice adds wallet proof and ownership-checked Mask Born persona previews at `/agents`.

## Backend configuration

Add these values to `backend/.env`:

```text
ARC_RPC_URL=https://rpc.testnet.arc.network
ARC_CHAIN_ID=5042002
ARC_DEPLOYMENT_BLOCK=<canonical collection deployment block>
MASKBORN_CONTRACT_ADDRESS=<canonical collection address>
MASKBORN_NAMES_ADDRESS=<optional names contract address>
```

Leave `MASKBORN_CONTRACT_ADDRESS` empty before the canonical deployment is selected. The Agents page will show a truthful waiting state and the protected preview endpoint returns `COLLECTION_NOT_CONFIGURED`.

Apply the Prisma schema and generate the client in development:

```powershell
cd backend
npx prisma db push
npx prisma generate
```

For production, create and review a migration against the production schema instead of using `db push`.

## Current endpoints

- `GET /api/agents/status` — public configuration status.
- `POST /api/wallet/challenge` — creates a ten-minute SIWE challenge.
- `POST /api/wallet/verify` — verifies EOA or supported contract-wallet signatures and creates a seven-day wallet session.
- `POST /api/wallet/logout` — revokes the current wallet session.
- `GET /api/agents/tokens/:tokenId/preview` — verifies current ownership, reads reveal/traits and returns the deterministic persona and Arc USDC balance.

Wallet authentication is distinct from the existing pasted payout wallet. The signed wallet is marked verified. A wallet already linked to another profile cannot be silently reassigned.

## Collection snapshot

The backend persona generator consumes `backend/src/generated/collection.json`, copied from the frontend's checked-in collection snapshot. `npm run sync:collection` now updates both copies after validating the generator manifest.

At the time of this implementation, the current `arcOne` manifest has more background traits than the website snapshot. The sync command correctly rejects that drift. Resolve which collection snapshot is canonical before refreshing either generated file.

## Verification

```powershell
cd backend
npm run check
npm test
npm run build
npx prisma validate

cd ../frontend
npm run check
npm run lint
npm test
npm run build
```

The page is functional once the schema is applied and the collection address is configured. Onchain awakening, token-bound accounts, paymasters, monitors and Payday contracts remain later implementation slices described by the system design.
