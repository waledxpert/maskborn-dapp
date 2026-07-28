# Mask Born Order

## Project overview, product rules, and technical system

Mask Born Order is a pre-launch, community-built pixel art collection. The collection
already has a real base character, generator, trait system, rarity model, and 10,000
token structure. This website gives the community a controlled way to take part before
the collection launches.

People can build with the existing traits, draw new artwork from the same base, publish
their work, share it, and vote on other submissions. The owner can review that work and
choose individual traits or complete 1/1 pieces for the official gallery and, later,
the generator itself.

The short version is:

> Born from the same base, made by different hands.

This is not an open mint page and it is not pretending the collection has already
launched. It is a community creation and curation system connected to the real Mask
Born Order art pipeline.

---

## What the project is trying to achieve

Most generative collections are finished behind closed doors and only shown to the
community when minting begins. Mask Born Order takes a different route. The main
collection still has one consistent art direction and one canonical generator, but
community members can help shape part of the final collection.

The project has five main goals:

1. Let people understand and experiment with the real Mask Born Order trait system.
2. Give pixel artists a friendly editor that starts from the correct collection base.
3. Let the community discover, discuss, share, upvote, and downvote submitted work.
4. Give the collection owner final curation control without hiding community opinion.
5. Preserve accepted art in a format that can be coded into the generator and later
   represented on-chain.

The website is therefore part gallery, part creation tool, part community voting
system, and part pre-launch collection workshop.

Community voting is a signal, not an automatic acceptance mechanism. A popular
submission can still be rejected if it breaks the collection's art rules. A less
popular submission can still be accepted if it fits the collection particularly well.
The admin makes the final collection decision.

---

## What already exists

The canonical collection lives outside this website repository:

```text
C:\Users\Hp\Desktop\arcOne
```

The generator is primarily located at:

```text
C:\Users\Hp\Desktop\arcOne\generator
```

That generator is the source of truth for:

- the 32×32 canvas;
- the base character;
- the layer order;
- existing trait names and artwork;
- rarity weights;
- compatibility behavior;
- normal generated tokens;
- reserved bespoke 1/1 artwork;
- the eventual contract-ready collection representation.

The website does not replace that generator. It imports a portable snapshot of the
generator's data and assets so the browser can display and test the collection without
requiring the original local folder in production.

The current snapshot describes:

- a total supply of 10,000;
- 9,981 rolled/generated tokens;
- 19 reserved 1/1 pieces;
- eight generator categories:
  `Background`, `Fur`, `Eyes`, `Ears`, `Tails`, `Masks`, `Hats`, and `Special`;
- 210 existing rolled traits across those categories.

These numbers should be read from the generated snapshot in application code. They
must not be copied into new handwritten constants because the real generator may
change.

---

## Current launch status

Mask Born Order is marked `PRELAUNCH`.

That means:

- the website can show collection previews;
- users can create profiles and link Discord;
- users can build, draw, publish, vote, share, and apply;
- admins can review submissions and place accepted work in the gallery;
- accepted source art can be exported for generator integration;
- no page should claim that a production collection contract already exists;
- no page should invent token ownership, sales, royalties, earnings, or trading fees;
- fee and payout database structures are preparation for a later launch, not proof of
  money currently owed.

Before launch, an accepted artist's profile should show the names of eligible accepted
collections or pieces. Actual balances should appear only after contracts, marketplace
event indexing, fee rules, and payout operations are live.

---

## Who uses the website

### Visitors

Visitors do not need an account. They can:

- view the home page;
- browse generated collection samples;
- view community submissions;
- browse the accepted gallery;
- open individual submission pages;
- follow creator usernames to their X profiles;
- use shared artwork links.

Visitors cannot vote, publish, save server drafts, submit an application, add a wallet,
or perform admin actions.

### Verified community members

A community member creates a profile with an X username and links one Discord account.
After Discord verification, the member can:

- paste a wallet address;
- complete the application flow;
- save drafts locally and to the backend;
- publish up to the allowed submission limits;
- vote during an artwork's open voting period;
- remove or change a vote while that period is open;
- share artwork pages;
- track every submission from the profile page.

### Creators

Every verified community member can become a creator. There is no separate creator
role. A creator can submit:

- up to two 1/1 artworks during the lifetime of the account;
- one submission opportunity for each supported community trait category.

The supported community drawing categories are currently:

- Background
- Eyes
- Hats
- Special

If one submission contains both Eyes and Hats, it consumes the account's Eyes
opportunity and Hats opportunity. The creator can still use Background and Special
later. Rejected work still consumes its opportunity, which prevents repeated spam and
makes each submission meaningful.

### Administrators

Administrators review community work, monitor abuse, manage restrictions, and decide
what enters the official gallery. Admin access is based on the stable Discord user ID
and a server-side `ADMIN` role.

Typing `/mboadmin` does not grant access. Every admin API route checks both verified
Discord identity and the database role.

---

## Identity and account model

The website deliberately separates public attribution from account verification.

### X username

The user pastes an X username. It is used for:

- public creator attribution;
- links to the creator's X profile;
- application and sharing context.

The website does not call the paid X API and does not claim the pasted username has
been cryptographically verified. It is stored as an `X_MANUAL` social identity.

An X username can be claimed by only one Mask Born Order profile. Usernames are
normalized before claiming, so adding `@`, changing letter case, or racing two requests
cannot create duplicate ownership.

### Discord

Discord OAuth2 is the action gate. It uses only the free `identify` scope.

A Discord ID can be connected to only one Mask Born Order profile. Once linked, that
Discord account becomes the login method for the existing profile. The member does not
need to relink it during every visit.

The connection modal separates two intentions:

- **Have an account** signs in with Discord and returns to the existing profile.
- **Create account** starts with the X username profile flow and then links Discord.

If someone selects **Have an account** but the Discord ID has no Mask Born Order
profile, the site explains that no account exists and directs the person to create one.
It must not silently create the wrong profile.

### Session

After account creation or Discord login, the backend creates a long-lived random
session token. Only a peppered hash is stored in Neon. The browser receives the token
in an HTTP-only cookie.

In production, browser API calls stay on the website's own `/api` origin. Next.js
forwards them to the backend using `BACKEND_URL`. This same-origin design lets the
Vercel domain own the session cookie and avoids the cross-domain login problem that
occurs when the browser calls Render directly.

### Wallet

WalletConnect is not required for this project. The member pastes an address.

The backend:

- detects whether the address is EVM or Solana;
- validates it;
- stores the original address and a normalized form;
- prevents the same wallet from belonging to multiple profiles.

A pasted wallet is an account association, not a signed proof of ownership. If signed
wallet verification becomes necessary at launch, it should be added as a separate
challenge flow without removing the existing profile history.

---

## Main user journey

### 1. Discover

The home page introduces the collection through the hero, featured carousel, and
latest community creations. The featured carousel uses real collection art and moves
slowly on its own while still supporting drag, touch, buttons, keyboard controls, and
pause.

### 2. Create or sign in

The member opens Connect, creates a profile with an available X username, and links
Discord. Returning members use **Have an account** and Discord logs them back into the
same profile.

### 3. Apply

The application flow asks the member to:

1. open the campaign post;
2. like it;
3. repost it;
4. comment on it;
5. assemble a Maskborn from available generator traits;
6. download the assembled result as PNG;
7. quote-post the result;
8. paste the quote-post URL;
9. paste a wallet address;
10. submit the application.

The browser remembers completion of the campaign actions so the final section remains
locked until the required steps have been opened. The backend stores X action states
as `PENDING_MANUAL`; opening a link is not treated as proof that X accepted the action.

Each profile can submit one application. Quote-post IDs and URLs are also unique so
the same post cannot be reused by multiple accounts.

### 4. Draw

The Draw page provides a 32×32 pixel editor. A creator chooses either:

- `ONE_OF_ONE`; or
- `TRAIT_EXTENSION`.

A 1/1 may begin from the base or, where the interface permits, from a blank artwork.
A trait extension keeps the canonical base visible while the creator draws compatible
art around it.

Background behaves differently. While painting a Background layer, the character is
hidden so the creator sees a clean 32×32 field. When previewing, downloading, or
publishing, the character returns above the completed background.

The editor includes:

- pixel drawing and erasing;
- brush sizes from 1 to 8 cells;
- a practical preset palette;
- custom color selection;
- separate named layers;
- layer visibility toggles;
- undo and redo;
- reset;
- PNG download;
- local persistence;
- server draft autosave for verified users;
- compatibility previews.

### 5. Check compatibility

New accessories are previewed against existing:

- Ears
- Masks
- Tails

Compatibility does not mean the new work becomes one of those trait types. It means
the creator can see whether a Hat, Eye, or Special collides with important parts of the
existing character.

Background compatibility is visual by construction because the character renders
above the background.

### 6. Publish

Publishing sends exact pixel-layer JSON and a preview. The server rebuilds the preview
from the submitted pixels and canonical base, hashes it, and rejects a mismatch. This
prevents a creator from showing one picture publicly while storing different source
pixels.

The server also checks:

- verified Discord identity;
- valid title and description;
- global title availability;
- valid layer names;
- unique accessory names within their trait categories;
- visible layers and submitted category agreement;
- supported trait types;
- submission slot availability;
- repeated artwork hashes;
- required compatibility data;
- active account restrictions;
- idempotency.

The title check ignores case, repeated whitespace, and Unicode presentation variants.
For example, `Bone Merchant`, `BONE MERCHANT`, and `Bone   Merchant` resolve to the
same title claim.

### 7. Vote and share

Published work enters the community feed and receives its own shareable page. The
page has dynamic image metadata so an external share can show the actual artwork,
title, creator, and voting context.

For a 1/1, the vote applies to the complete artwork.

For a multi-trait submission, the voter chooses the specific trait being judged, such
as Background or Hats. This keeps a strong Hat from hiding a weak Eye layer and gives
the admin more useful feedback.

### 8. Admin review

The admin can:

- search and sort the review queue;
- filter by time and votes in ascending or descending order;
- inspect exact private source data;
- review individual trait previews and combinations;
- accept one trait, several traits, or all traits from a multi-trait submission;
- accept a complete 1/1;
- reject or move work through review states;
- add accepted work to the public gallery;
- monitor suspicious users and signals;
- restrict accounts or voting;
- lift restrictions;
- record an audit reason for sensitive actions.

If a submission contains Background and Hats, the admin can accept only Hats. The
gallery then shows the accepted Hat on the canonical base rather than exposing the
rejected Background.

### 9. Integrate accepted work

Gallery acceptance does not automatically rewrite the collection generator. The owner
exports the accepted submission, reviews the canonical data, assigns its final
generator name and rarity, then codes it into the real `arcOne` generator.

This deliberate step keeps the official collection reproducible and prevents website
data from silently changing contract art.

---

## Website pages

| Route | Purpose |
| --- | --- |
| `/` | Hero, featured carousel, and latest creations |
| `/collection` | Pre-launch generated library, traits, and collection samples |
| `/community` | Searchable and filterable community submission feed |
| `/gallery` | Accepted community art; only creator usernames link out |
| `/art/[slug]` | Individual submission, trait combinations, voting, and sharing |
| `/apply` | Campaign actions, trait builder, wallet, and application |
| `/draw` | Pixel editor, compatibility tests, draft saving, and publish |
| `/profile` | Identity, wallet, drafts, submissions, status, and eligible names |
| `/connect/discord` | Styled Discord login/link transition and backend wake-up |
| `/mboadmin` | Protected review, gallery, and abuse-management dashboard |

The site uses the Mask Born Order design language:

- bone/off-white `#EDEAE2`;
- warm amber `#F2B441`;
- near-black `#1A1815`;
- Bebas Neue for display type;
- Work Sans for interface and body text;
- minimal surfaces;
- no gradients.

The responsive layout supports desktop, tablet, and phone sizes. Dense controls become
scrollable or compact instead of forcing the page wider than the screen.

---

## How the generator and website stay connected

The website contains generated collection snapshots under the frontend source and
public asset folders. The sync command verifies them against the `arcOne` manifest:

```powershell
npm run sync:collection
```

The sync script:

1. locates `arcOne` using `ARCONE_PATH` or the expected sibling folder;
2. reads the contract-data manifest;
3. reads the website's portable collection and renderer snapshots;
4. compares category and legend counts;
5. verifies every referenced trait preview exists;
6. confirms the renderer remains 32×32;
7. writes the explicit `PRELAUNCH` status.

Production never reads `C:\Users\Hp\Desktop\arcOne` directly. The required snapshots
and public assets must be synchronized and committed before deploying.

### Canonical generator composition

The Mask Born Order art is not a simple stack of transparent images. The true generator
has compatibility and redraw steps. In simplified form it:

1. draws the tail behind the body;
2. draws the shared body;
3. decides whether the selected hat allows both ears, one ear, or no ears;
4. restores important body shading;
5. draws the mask and default eye cells;
6. applies the fur color mapping and pattern;
7. draws the selected eye trait;
8. creates the silhouette outline;
9. draws fur glow, Hat, and Special layers;
10. shifts the character down two pixels;
11. fills remaining empty cells with the Background.

This order matters. Changing it changes the art and can make a website preview disagree
with an eventual on-chain token. The collection fixtures exist to catch that drift.

---

## Submission data format

The editable source is structured pixel JSON, not a screenshot:

```json
{
  "schemaVersion": 2,
  "startBlank": false,
  "layers": [
    {
      "id": "background-1",
      "kind": "Background",
      "name": "Amber Static",
      "visible": true,
      "pixels": [
        { "x": 4, "y": 9, "color": "#F2B441" }
      ]
    }
  ]
}
```

Every pixel has:

- an integer `x` from 0 to 31;
- an integer `y` from 0 to 31;
- a six-digit hexadecimal color.

Every layer has:

- a stable ID;
- one supported kind;
- a creator-supplied name;
- visibility state;
- its own pixel list.

Keeping separate layers is important. It allows:

- the creator to hide and inspect one trait;
- the individual page to show one trait or a chosen combination;
- voters to target a particular trait;
- the admin to accept only part of a submission;
- the exporter to create generator-ready deltas;
- the eventual on-chain renderer to preserve deterministic layer meaning.

The PNG and SVG files are previews. The JSON remains the editable and generator-ready
source of truth.

### Canonical export

For accepted work, the backend exporter:

- downloads the exact private source;
- verifies the stored SHA-256 hash;
- validates the canvas, pixels, colors, and layer types;
- removes hidden layers;
- resolves overlapping pixels deterministically;
- sorts pixels by row and column;
- writes canonical JSON;
- writes a JavaScript module for generator integration;
- stores the canonical hash and object key.

Run:

```powershell
cd backend
npm run export:submission -- submission-id-or-slug
```

The default output is:

```text
backend/exports/accepted/{slug}.source.json
backend/exports/accepted/{slug}.canonical.json
backend/exports/accepted/{slug}.mjs
```

The runtime and export path are JavaScript/TypeScript. The original generator may have
Python files, but that does not require the website backend to run Python.

---

## Storage architecture

The system separates relational data from artwork objects.

### Neon/PostgreSQL

Neon stores small, queryable records such as:

- users and social identities;
- sessions;
- wallets and applications;
- draft metadata and revisions;
- submission titles, categories, hashes, and statuses;
- vote records and counters;
- restrictions and risk events;
- gallery decisions;
- object-storage keys;
- future fee and payout records;
- admin audit logs;
- idempotency records.

Neon should not carry thousands of large SVGs and full source payloads as the primary
production object store.

### Cloudflare R2

R2 stores artwork objects:

- private bucket: exact source JSON and canonical accepted JSON;
- public bucket: immutable SVG previews and trait preview combinations.

A new submission uses content-addressed paths similar to:

```text
private/submissions/{userId}/{sourceHash}/source.json
public/submissions/{userId}/{previewHash}/preview.svg
public/submissions/{userId}/{sourceHash}/variants/{combination}.svg
```

The source bucket remains private. The browser never receives R2 access credentials.
The public bucket can use an `r2.dev` URL or a custom asset domain.

Local development falls back to:

```text
backend/.local-storage/private
backend/.local-storage/public
```

This design means 10,000 submissions mainly add small Neon rows while the heavier
artwork data lives in object storage.

---

## Voting rules

Voting is available only to verified Discord accounts.

The rules are:

- a voter has one current vote per submission and trait target;
- a vote is `UP` or `DOWN`;
- the voter can change or remove it while voting remains open;
- the voting window closes exactly 24 hours after `publishedAt`;
- server time is authoritative;
- after the deadline, the vote is frozen;
- 1/1 votes have no trait category;
- one-trait submissions can infer the target;
- multi-trait submissions require the voter to choose a target.

Vote changes, counters, event logs, and idempotency records are written together in a
serializable transaction. Rapid retries cannot increase a count twice.

### Spam protection

The API combines:

- verified Discord identity;
- account-based request limits;
- an application-wide rate limit;
- hashed network/device signals;
- vote-event history;
- burst detection;
- six-hour restrictions;
- admin review and manual restrictions.

Raw IP addresses are not stored for this mechanism. A peppered signal hash is used to
identify suspicious repetition without turning the risk table into a plain IP log.

---

## Duplicate and concurrency protection

The backend assumes users may double-click, refresh, retry after a timeout, use two
tabs, or intentionally race requests.

Important protections include:

- one profile claim per normalized X username;
- one profile per Discord ID;
- one profile per normalized wallet;
- one application per profile;
- one use per X quote post;
- globally unique normalized submission titles;
- one use per accessory name within its category;
- one copy of the same artwork hash per creator;
- one current vote per creator, submission, and trait target;
- one gallery entry per submission;
- one gallery registration per on-chain token;
- versioned draft revisions;
- idempotency keys for publish and vote mutations;
- advisory and serializable transaction locking around submission limits.

Known conflicts return clear codes such as:

- `SUBMISSION_TITLE_TAKEN`
- `ACCESSORY_NAME_TAKEN`
- `X_USERNAME_TAKEN`
- `WALLET_ALREADY_CLAIMED`
- `QUOTE_POST_ALREADY_USED`
- `APPLICATION_ALREADY_SUBMITTED`
- `ARTWORK_ALREADY_SUBMITTED`
- `DRAFT_CONFLICT`
- `GALLERY_ENTRY_EXISTS`

Database constraints remain the final defense against two requests that pass a
pre-check at the same moment.

---

## Draft reliability

The Draw page saves to two places:

1. Zustand persistence stores the active work in the browser.
2. Verified members also autosave versioned drafts to the API.

Local saving happens first, so accidentally leaving or refreshing the browser should
not erase the drawing. Server drafts use an `expectedVersion` value. If an older tab
tries to overwrite a newer edit, the API returns `DRAFT_CONFLICT` instead.

The live title and accessory-name checks are debounced. They run only after the user
pauses typing, and canvas pixel edits do not repeatedly query name availability.

---

## Gallery behavior

The community feed and accepted gallery are different:

- **Community** contains public submissions that are still being discussed and voted
  on.
- **Gallery** contains only work deliberately accepted by an administrator.

Gallery cards are display pieces. On `/gallery`, the card itself does not open the
individual artwork route. Only the creator username is interactive and links to X.

For accepted trait work, the gallery uses the exact accepted preview combination. If
only Eyes were accepted from an Eyes + Hat submission, the gallery shows those Eyes on
the canonical base without the unaccepted Hat.

---

## Admin and moderation model

The admin namespace is:

```text
/api/mboadmin/*
```

The interface route is:

```text
/mboadmin
```

The old `/admin` route is intentionally absent.

Sensitive admin actions are performed on the backend and recorded in
`AdminAuditLog` with:

- the acting admin;
- action name;
- target type and ID;
- before and after data where relevant;
- reason;
- request ID;
- timestamp.

The abuse panel can search accounts and inspect vote counts, risk events, restrictions,
and identifying profile context. Restrictions may target voting, submission, or the
whole account and may later be lifted by an admin.

---

## How accepted artwork can become on-chain art

The website already preserves what an on-chain generative system needs: deterministic
pixel coordinates, colors, layer categories, ordering, hashes, and generator version.

The intended path is:

```text
Draw in browser
    ↓
Store exact layer JSON
    ↓
Community voting and admin review
    ↓
Export canonical accepted JSON and JavaScript module
    ↓
Code the accepted trait into the canonical generator
    ↓
Assign final index, rarity, and compatibility rules
    ↓
Regenerate fixtures and contract data
    ↓
Deploy the collection contract and renderer
```

There are several possible on-chain storage strategies:

### Fully on-chain pixels

Store compact pixel or run-length data in contract storage or bytecode. The renderer
reconstructs the SVG from trait indexes and packed pixel data. This offers strong
on-chain permanence but costs more gas and requires careful compression.

### On-chain trait indexes with an on-chain renderer

Each token stores or derives trait indexes. A renderer contract contains the canonical
trait tables and composes SVG metadata. This matches a generative collection well and
avoids storing a complete duplicate image for every token.

### Immutable content-addressed data

Store canonical metadata and art on IPFS/Arweave and put immutable content hashes or
URIs on-chain. This is cheaper but is not the same as fully reconstructing every pixel
inside the EVM.

The current source format supports all three. The final choice belongs in the
collection contract design, not in the community website.

The `GalleryEntry` model already has optional chain ID, contract, token ID, and metadata
URI fields. They remain empty until there is a real deployment.

---

## Future creator fees

The schema reserves a path for creator participation:

1. an accepted gallery entry can receive a `FeeShare`;
2. a future indexer records unique marketplace `TradeFeeEvent` records;
3. each event can produce one `CreatorAccrual` per eligible fee share;
4. approved accruals can be grouped into a `Payout`;
5. a payout records its chain, currency, amount, status, and transaction hash.

This model protects against processing the same chain log or accrual twice.

It is not active income logic yet. Before enabling it, the project still needs:

- a deployed collection contract;
- a written fee-share policy;
- the exact basis points for each eligible work;
- supported marketplaces;
- a reorg-aware event indexer;
- currency and decimal handling;
- payout approval and signing rules;
- legal and tax review where applicable.

Until those exist, the UI should display eligible accepted names only.

---

## Technical architecture

### Frontend

- Next.js App Router
- TypeScript
- Tailwind CSS
- Motion
- Zustand
- Lenis
- TanStack Query
- Zod

The frontend handles presentation, local drafts, interactive rendering, optimistic
updates, responsive controls, and same-origin API requests.

### Backend

- Node.js
- Express
- TypeScript
- Prisma 7
- Neon/PostgreSQL
- Zod
- Cloudflare R2 through its S3-compatible API

The backend is authoritative for identity, permissions, validation, uniqueness,
submission limits, votes, moderation, storage hashes, and gallery decisions.

### Request path in production

```text
Browser
  → https://maskborn.vercel.app/api/...
  → Next.js server-side proxy
  → Render backend through BACKEND_URL
  → Neon and/or Cloudflare R2
```

Discord also returns to the website domain:

```text
https://maskborn.vercel.app/api/auth/discord/callback
```

The proxy forwards that callback to the backend, and the resulting session cookie stays
owned by the website origin.

---

## Important environment variables

Frontend:

```env
NEXT_PUBLIC_SITE_URL=https://maskborn.vercel.app
NEXT_PUBLIC_X_CAMPAIGN_POST_URL=https://x.com/YOUR_ACCOUNT/status/YOUR_POST_ID
BACKEND_URL=https://YOUR-RENDER-BACKEND
```

Backend:

```env
NODE_ENV=production
FRONTEND_URL=https://maskborn.vercel.app
BACKEND_PUBLIC_URL=https://YOUR-RENDER-BACKEND
DATABASE_URL=YOUR_NEON_POOLED_URL
DATABASE_URL_UNPOOLED=YOUR_NEON_DIRECT_URL
SESSION_PEPPER=LONG_RANDOM_SECRET
SIGNAL_PEPPER=DIFFERENT_LONG_RANDOM_SECRET
DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...
DISCORD_CALLBACK_URL=https://maskborn.vercel.app/api/auth/discord/callback
ADMIN_DISCORD_IDS=...
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_PRIVATE_BUCKET=...
R2_PUBLIC_BUCKET=...
R2_PUBLIC_BASE_URL=...
```

Secrets belong only in backend or server-side deployment settings. Never put database,
Discord secret, pepper, or R2 secret values into a `NEXT_PUBLIC_*` variable.

---

## Local development

Synchronize the collection:

```powershell
cd C:\Users\Hp\Desktop\maskborn
npm run sync:collection
```

Run the backend:

```powershell
cd backend
npm install
npx prisma generate
npx prisma db push
npm run dev
```

Run the frontend in another terminal:

```powershell
cd frontend
npm install
npm run dev
```

Local addresses:

```text
Website: http://localhost:3000
Backend: http://localhost:4000
```

Run the quality checks:

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

After any Prisma schema change:

```powershell
cd backend
npx prisma generate
npx prisma db push
```

For an established production database, inspect the planned SQL or use a reviewed
migration before applying a destructive schema change.

---

## Operating workflow

When the original collection changes:

1. update and verify the `arcOne` generator;
2. export the updated manifest/assets;
3. run `npm run sync:collection`;
4. run frontend renderer tests;
5. review the collection page and builder;
6. commit the portable snapshot and assets;
7. deploy.

When community art is accepted:

1. accept the exact categories in `/mboadmin`;
2. confirm the public gallery preview;
3. export the accepted submission;
4. review canonical pixels and compatibility;
5. add the trait or 1/1 to `arcOne`;
6. assign final naming, indexing, and rarity;
7. regenerate collection and contract data;
8. sync this website again;
9. run all tests;
10. deploy the updated snapshot.

When investigating abuse:

1. search the admin abuse panel;
2. compare account, vote, signal, and risk-event history;
3. apply the narrowest useful restriction;
4. include a clear reason;
5. review the audit record;
6. lift the restriction when appropriate.

---

## Product rules that should not drift

- The project remains clearly pre-launch until a real contract is deployed.
- The `arcOne` generator remains the final collection source of truth.
- Community pixels stay separated by trait type.
- Visitors may browse, but acting requires verified Discord.
- X username is public attribution, not verified X ownership.
- Wallets are pasted and validated; they are not automatically signed.
- A member receives two lifetime 1/1 submission opportunities.
- Each supported community trait category can be submitted once per member.
- Multi-trait submissions consume every included category.
- Voting stays editable for 24 hours from publication, then freezes.
- Multi-trait votes target a particular trait.
- Admins may accept only part of a multi-trait submission.
- Gallery acceptance does not silently alter the generator.
- Accepted source data must remain exportable and hash-verifiable.
- No invented royalties, earnings, or token ownership appear before launch.
- Admin access is always enforced by the backend.
- Public artwork previews never replace the private canonical pixel source.

---

## What the project is not

Mask Born Order is not:

- a generic NFT generator disconnected from the original collection;
- a WalletConnect-first mint page;
- a paid X API integration;
- a promise that every submission will become a token;
- an automatic popularity contest;
- a launched marketplace;
- a live royalty dashboard;
- a system where frontend-hidden buttons count as security;
- a place where screenshots replace editable pixel data.

It is a structured way for the community to help create a coherent on-chain pixel
collection while the owner keeps the art, generator, security, and final curation
consistent.

---

## Related documentation

- [Implementation plan](../PLAN.md)
- [Discord setup](DISCORD_SETUP.md)
- [Admin setup](ADMIN_SETUP.md)
- [Storage and accepted-art export](STORAGE_SETUP.md)
- [Render deployment](RENDER_SETUP.md)
- [X username and campaign setup](X_SETUP.md)
- [Repository README](../README.md)

