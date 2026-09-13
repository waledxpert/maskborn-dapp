# Agent Phase 1 setup

The first implementation slice adds wallet proof and ownership-checked Mask Born persona previews at `/agents`.

The second slice adds live owned-token discovery, unified Arc USDC monitoring, recurring expected-payment rules, and an in-app alert inbox. Monitoring is read-only and uses Arc's canonical USDC `Transfer` event for native and ERC-20-style sends.

The third slice adds the collection-wide ownership index and ownership-isolated persistent assistant conversations. Private chat remains disabled until an external provider is explicitly configured and each holder accepts the displayed data-sharing disclosure for the current ownership period.

## Backend configuration

Add these values to `backend/.env`:

```text
ARC_RPC_URL=https://rpc.testnet.arc.network
ARC_CHAIN_ID=5042002
ARC_DEPLOYMENT_BLOCK=<canonical collection deployment block>
MASKBORN_CONTRACT_ADDRESS=<canonical collection address>
MASKBORN_NAMES_ADDRESS=<optional names contract address>
AGENT_MODEL_PROVIDER=disabled
```

Leave `MASKBORN_CONTRACT_ADDRESS` empty before the canonical deployment is selected. The Agents page will show a truthful waiting state and the protected preview endpoint returns `COLLECTION_NOT_CONFIGURED`.

Apply the Prisma schema and generate the client in development:

```powershell
cd backend
npx prisma db push
npx prisma generate
```

Run the API and monitor worker in separate processes:

```powershell
cd backend
npm run dev

# In another terminal
cd backend
npm run dev:agent-worker
```

The worker polls every 15 seconds by default. Set `AGENT_MONITOR_INTERVAL_MS` to a value from 5000 through 300000 milliseconds when needed. Payment and notification identities are unique, so restarts do not create duplicate alerts.

The same worker indexes all collection `Transfer` events in bounded ranges. With `ARC_DEPLOYMENT_BLOCK=0`, it attempts to discover the first block containing the configured contract bytecode. Set the exact deployment block in production to make startup deterministic.

To enable the optional OpenAI Responses API adapter, configure these backend-only values:

```text
AGENT_MODEL_PROVIDER=openai
AGENT_MODEL_API_KEY=<server-side key>
AGENT_MODEL_NAME=<explicit model name>
AGENT_MODEL_BASE_URL=https://api.openai.com/v1
AGENT_DAILY_REQUEST_LIMIT=25
```

The API key must never be prefixed with `NEXT_PUBLIC_` or exposed to the browser. Model requests use `store: false`. The UI names the destination and fields that may be shared, records consent per ownership period, and provides immediate revocation. No provider call occurs without active consent plus a per-request sharing assertion.

For production, create and review a migration against the production schema instead of using `db push`.

## Current endpoints

- `GET /api/agents/status` — public configuration status.
- `POST /api/wallet/challenge` — creates a ten-minute SIWE challenge.
- `POST /api/wallet/verify` — verifies EOA or supported contract-wallet signatures and creates a seven-day wallet session.
- `POST /api/wallet/logout` — revokes the current wallet session.
- `GET /api/agents/tokens/:tokenId/preview` — verifies current ownership, reads reveal/traits and returns the deterministic persona and Arc USDC balance.

Wallet authentication is distinct from the existing pasted payout wallet. The signed wallet is marked verified. A wallet already linked to another profile cannot be silently reassigned.

Additional endpoints in the second slice:

- `GET /api/agents/owned`
- `GET/POST /api/agents/tokens/:tokenId/monitors`
- `POST /api/agents/tokens/:tokenId/monitors/:id/sync`
- `DELETE /api/agents/tokens/:tokenId/monitors/:id`
- `GET /api/notifications`
- `POST /api/notifications/:id/read`
- `GET /api/agents/index/status`
- `GET /api/agents/chat/status`
- `GET/POST/DELETE /api/agents/tokens/:tokenId/model-consent`
- `GET /api/agents/tokens/:tokenId/conversations`
- `GET /api/agents/tokens/:tokenId/conversations/:conversationId`
- `POST /api/agents/tokens/:tokenId/chat`

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

The page is functional once the schema is applied and the collection address is configured. Onchain awakening, token-bound accounts, paymasters and Payday contracts remain later implementation slices described by the system design.
