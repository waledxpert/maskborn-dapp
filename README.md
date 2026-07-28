# Mask Born Order

Community website and API for the pre-launch Mask Born Order pixel collection.

The real collection generator lives in `C:\Users\Hp\Desktop\arcOne\generator`.
This repository does not duplicate its art rules by hand. Run the sync command when
the generator, contract-data manifest, rarity, or 1/1 set changes.

## Structure

- `frontend`: Next.js, TypeScript, Tailwind CSS, Motion, Zustand, Lenis, TanStack
  Query, and viem.
- `backend`: Express, TypeScript, Prisma, and PostgreSQL/Neon.
- `docs/PROJECT_OVERVIEW.md`: plain-language product vision, complete user journeys,
  system rules, storage model, generator integration, moderation, and on-chain path.
- `docs/STORAGE_SETUP.md`: private/public R2 setup and accepted-submission export.
- `scripts/sync-collection.mjs`: validates the exported generator manifest and the
  portable metadata, renderer data, trait previews, fixtures, and 1/1 SVGs using JavaScript.
- `PLAN.md`: product rules, generator pipeline, API boundaries, abuse handling, and
  the community curation and future launch model.

## Run locally

Sync the collection:

```powershell
npm run sync:collection
```

Start the frontend:

```powershell
cd frontend
npm install
npm run dev
```

Start the API in another terminal:

```powershell
cd backend
Copy-Item .env.example .env
# Fill in the Neon and Discord values in .env
npm install
npx prisma generate
npx prisma db push
npm run dev
```

The defaults are `http://localhost:3000` for the site and
`http://localhost:4000` for the API.

## Checks

```powershell
cd frontend
npm run check
npm run lint
npm test
npm run build

cd ..\backend
npm run check
npm test
npm run build
npx prisma validate
```

The frontend fixture test renders known trait combinations in TypeScript and compares
their 32×32 pixels against the checked-in reference SVGs. A mismatch means the website
has drifted from the collection snapshot.

## Production configuration

The frontend uses the website URL plus a server-only backend proxy target:

```text
NEXT_PUBLIC_SITE_URL=https://maskborn.example
BACKEND_URL=https://api.maskborn.example
```

Browser requests stay on the website's `/api` origin. Do not add
`NEXT_PUBLIC_API_URL`; the Next.js proxy reads `BACKEND_URL` on the server.

Backend variables are documented in `backend/.env.example`. Users paste an unverified
X username for public attribution, so the website does not call or pay for the X API.
Wallets are pasted and validated; the community application flow does not use
WalletConnect. The collection page currently shows pre-launch previews only; no owner
lookup or deployed contract is claimed.

The username and campaign-link behavior is documented in `docs/X_SETUP.md`. Required
Discord verification and Developer Portal setup are documented in
`docs/DISCORD_SETUP.md`.

Exact pixel-layer JSON and previews use Cloudflare R2 in production so Neon retains
only small relational records, object keys, and hashes. Local development uses
`backend/.local-storage`. Setup and the generator-ready accepted-art export command are
documented in `docs/STORAGE_SETUP.md`.

For Neon, use its pooled URL for `DATABASE_URL` at runtime and its direct, unpooled
URL for `DATABASE_URL_UNPOOLED`. Prisma CLI commands read the unpooled URL from
`backend/prisma.config.ts`; the API uses the pooled URL through the Neon adapter.

Community submissions can be accepted as 1/1s or generator traits before launch.
Future payout eligibility is recorded by accepted collection name; earnings and trading
fees are not shown until contracts and an indexing policy actually exist.
