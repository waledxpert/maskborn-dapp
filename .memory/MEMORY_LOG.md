# Memory Log
> Append-only. Never delete or edit previous entries.
> Initialized: 2026-07-25

---
## 2026-07-25 — Generator integration and full-stack foundation

- Studied `C:\Users\Hp\Desktop\arcOne\generator` and treated its scripts, assets, validators, and contract manifest as the collection source of truth.
- Confirmed a 32×32 canvas, 10,000 origin supply, 19 baked legends, 9,981 rolled tokens, and 210 traits across Background, Fur, Eyes, Ears, Tails, Masks, Hats, and Special.
- Documented and ported the generator's exact render order, symbolic fur palette behavior, hat/ear compatibility rules, and validation constraints.
- Revised `PLAN.md` to distinguish the sealed origin collection from community gallery entries and a future onchain extension. Creator trading-fee shares require a separate extension contract or marketplace fee router.
- Added `scripts/sync-collection.py` to validate and sync generator metadata plus real SVG previews into the frontend without modifying `arcOne`.
- Built the Next.js frontend routes and interactions, including the adaptive header, account modal, origin carousel, community voting/feed, application builder, draw studio with persisted drafts, gallery, profile, collection lookup, and admin review views.
- Added a TypeScript renderer verified pixel-for-pixel against 16 Python generator fixtures.
- Built the Express/Prisma backend foundation with X OAuth PKCE, pasted-wallet profiles, idempotent applications, versioned drafts, two-slot submission limits, 24-hour vote locking, abuse restrictions, moderation/audit history, gallery promotion, and fee accounting.
- Verification passed: frontend lint, type check, 16 renderer tests, and production build; backend Prisma validation, type check, 2 API tests, and production build.
- Live Neon migrations and X OAuth cannot be exercised until deployment credentials are provided.

## 2026-07-25 — Prisma 7 and Neon configuration

- Upgraded the backend from Prisma 6.19 to Prisma 7.9 and added the official Neon driver adapter.
- Moved the Prisma CLI connection URL out of `schema.prisma` into root-level `backend/prisma.config.ts`.
- Runtime uses Neon’s pooled `DATABASE_URL`; migrations and other CLI operations use `DATABASE_URL_UNPOOLED`.
- Switched to the Prisma 7 `prisma-client` generator with output under `backend/src/generated/prisma`.
- Removed an exposed Neon credential from `.env.example` and replaced it with safe placeholders; the exposed credential should be rotated in Neon.
- Prisma generation and validation, TypeScript checks, API tests, and the production backend build all pass.

## 2026-07-25 — X API implementation audit

- Audited the X integration against the current official X OAuth, REST API, pricing, and hosted MCP documentation.
- Confirmed `https://api.x.com/mcp` is developer/AI tooling and must not replace per-visitor OAuth in the public website.
- Added the missing `like.read` scope, token refresh support, dedicated token-encryption configuration, X token revocation, and removal of the linked social account on disconnect.
- Implemented application verification using the applicant's X user token: quote ownership/target, recent liked posts, and recent timeline repost/reply references.
- Added strict X status URL parsing and a unique `quotePostId` to prevent the same quote from being submitted through URL variants.
- Added campaign environment variables, a real frontend campaign link, and `docs/X_SETUP.md` with Developer Console and optional MCP setup.

## 2026-07-25 — Replaced paid X integration with pasted usernames

- Removed X OAuth, X REST API activity verification, token storage/refresh/revocation, and all X credential environment variables.
- The connect modal now accepts a pasted X username and creates an unverified 30-day browser session.
- Manual X identities use the `X_MANUAL` provider and are explicitly shown as unverified attribution.
- Like, repost, reply, and quote ownership states remain `PENDING_MANUAL` for admin review.
- Strict quote-post URL validation and duplicate quote-post protection remain in place.
- Updated the plan, README, frontend campaign configuration, profile data source, and `docs/X_SETUP.md` for the no-cost manual flow.

## 2026-07-25 — Discord verification gate

- Added free Discord OAuth2 account linking with the minimal `identify` scope; no bot, guild access, or server installation is required.
- A stable Discord user ID can be linked to only one Mask Born Order profile and is stored as a verified `DISCORD` social identity.
- Added `requireVerifiedDiscord` to wallet changes, applications, votes, server draft saves, submissions, and every admin mutation.
- Anonymous and unverified visitors retain read-only access to public pages and feeds.
- Updated the connect modal to show X attribution, Discord verification, then wallet as three distinct steps.
- Added Discord recovery: a returning user can sign in through the same Discord account and recover the existing profile session.
- Added `docs/DISCORD_SETUP.md` and Discord environment placeholders.

## 2026-07-25 — Discord callback and server-secret notes

- Confirmed the local backend generates the Discord OAuth callback
  `http://localhost:4000/api/auth/discord/callback`.
- An `Invalid OAuth2 redirect URL` response means that exact URL is not saved under
  OAuth2 Redirects for the same Discord application referenced by `DISCORD_CLIENT_ID`.
- Discord redirect matching is exact: scheme, hostname, port, path, and trailing slash
  must match. The current local configuration uses `http`, `localhost`, port `4000`,
  and no trailing slash.
- `SESSION_PEPPER` is mixed into stored session-token hashes. Rotating it invalidates
  every existing login session.
- `SIGNAL_PEPPER` is mixed into privacy-preserving IP/user-agent abuse fingerprints.
  Rotating it breaks continuity with previously recorded risk signals.
- Both peppers must be separate, randomly generated backend secrets of at least 32
  characters and must never be committed or exposed to the frontend.

## 2026-07-25 — Pre-launch correction, application flow, and pixel studio

- Corrected the product throughout the visible site, README, plan, and generated
  snapshot to `PRELAUNCH`; the website no longer claims a deployed contract, owner
  lookup, indexed trading activity, earned ETH, or creator fee percentages.
- Replaced the Python website sync entry point with `scripts/sync-collection.mjs` and
  `npm run sync:collection`. The JavaScript validator confirmed 210 traits, 19 1/1
  references, 16 generated fixtures, the 32×32 canvas, and the 10,000-item supply.
- Limited the featured carousel to Red Panda and Skunk as the only 1/1 cards, followed
  by normal generated examples; reduced selected labels and improved small-screen
  visibility.
- Centered and repaired the adaptive MBO header, kept the O inside its circle, added an
  always-available compact mobile menu, and rebuilt the mobile menu and identity modal
  layouts for narrow screens.
- Extended authenticated sessions to one year. A verified Discord identity remains
  attached to its database profile and can recover that same profile through Discord;
  read-only visitors remain able to browse.
- Rebuilt Apply so Like, Repost, and Comment open the configured X campaign actions,
  persist completion locally, and unlock the final fields only after all three. Added
  a self-contained SVG download, up to 30 choices per trait category, wheel-driven
  horizontal trait rails, and permanent one-application enforcement in both local UI
  state and the database/API.
- Rebuilt Draw as a real responsive 32×32 pixel editor in TypeScript with canonical-base
  or blank 1/1 starts, mandatory base starts for accessories, multiple hideable Eyes,
  Hats, and Special layers, pencil/eraser tools, palette, local persistence, versioned
  server autosave, self-contained SVG download, and previews against all ten real ear
  traits.
- Draw publishing now sends idempotent community submissions to the API with pixel
  layers, compatibility evidence, content hash, and preview SVG. The API still enforces
  two active 1/1 slots and two active accessory/trait slots per verified profile.
- Profiles now list future payout-eligible collection names (currently the Bone
  Merchant example) without fabricated balances.
- Verification passed after the changes: frontend TypeScript, ESLint, 16 renderer
  tests, and production build; backend TypeScript, 5 API tests, production build,
  Prisma 7 client generation, and Prisma schema validation.
- The new unique application-per-user database constraint must be applied to the target
  Neon database with the normal Prisma deployment command before production rollout.

## 2026-07-25 — Generated library, carousel, PNG downloads, and color picker

- Kept Red Panda as the only visible pre-launch 1/1 on the public-facing collection
  presentation and removed the separate 1/1 library from the Collection page.
- Expanded the home carousel to Red Panda plus all 16 normal generated fixture masks.
- Made carousel dimensions fluid on desktop and mobile and hid the selected-card
  metadata on narrow screens so it no longer covers the artwork.
- Made the normal generated collection library use every fixture with an adaptive
  desktop grid and a compact two-column mobile grid.
- Changed both Apply builder downloads and Draw studio downloads to crisp 1024×1024
  PNG files with pixel smoothing disabled. Draw still publishes its structured pixel
  layers and SVG preview to the backend for generator review.
- Expanded Draw to 16 common colors and added a native custom color picker with the
  active hexadecimal value, allowing creators to select or mix any color.
- Frontend TypeScript, ESLint, 16 renderer tests, and the production build all passed.

## 2026-07-25 — Expanded compatibility and lifetime trait limits

- Expanded Draw compatibility from Ears only to selectable Ears, Masks, and Tails
  groups backed by every real trait in those generator categories.
- Added Background as the fourth community-draw trait alongside Eyes, Hats, and
  Special.
- Background editing hides the Maskborn on a plain 32×32 canvas. A dedicated completion
  toggle restores the Maskborn above the painted pixels; downloads and published
  previews also composite Background beneath the base and all other layers above it.
- Changed submission allowance to two lifetime 1/1 submissions and one lifetime
  submission for each of Background, Eyes, Hats, and Special. Multi-trait posts consume
  every category they include, and rejected submissions still consume those chances.
- The backend now accepts only those four community trait categories, serializes
  publish checks per user with a PostgreSQL advisory transaction lock, and returns a
  specific conflict listing already-used categories.
- The Draw page loads profile slot state, removes used trait types from the add-layer
  choices, disables 1/1 after both chances are consumed, and blocks publishing a
  persisted draft containing an already-submitted type.
- The Profile page now shows live 1/1 usage out of two and live trait-category usage out
  of four instead of the former hardcoded two-trait-slot presentation.
- Updated `PLAN.md` to reflect the four submission traits, three compatibility groups,
  background compositing behavior, and lifetime allowance rules.
- Verification passed: frontend TypeScript, ESLint, 16 renderer tests, and production
  build; backend TypeScript, 5 API tests, and production build.

## 2026-07-25 — R2 submission objects and accepted-art exporter

- Added Cloudflare R2 support through the S3-compatible AWS SDK with separate private
  and public buckets. Exact pixel-layer source JSON and canonical accepted JSON use the
  private bucket; immutable SVG previews use the public bucket.
- Added a development fallback under `backend/.local-storage`, including a public asset
  endpoint, so submission publishing works without Cloudflare credentials locally.
- Production configuration now requires a complete R2 configuration and rejects a
  partial/missing setup instead of silently writing artwork to ephemeral server disk.
- New submission records keep only a small source reference in `pixelData` plus
  `pixelDataKey`, `sourceHash`, `previewAssetKey`, `storageProvider`, and public preview
  URL. Canonical export keys and hashes have dedicated fields.
- Publishing verifies the client preview SHA-256 on the server, writes exact formatted
  source JSON privately, writes its SVG preview publicly, then stores relational
  metadata and hashes in Neon. The public feed explicitly omits source payloads.
- Added an admin-only source retrieval endpoint at
  `GET /api/admin/submissions/{id}/source`, with compatibility for older database-only
  submissions.
- Added strict source validation for a 32×32 canvas, bounded coordinates, six-digit hex
  colors, layer limits, and the four community kinds: Background, Eyes, Hats, Special.
- Added `npm run export:submission -- <id-or-slug> [--out path]`. It accepts only
  reviewed/accepted work, retrieves and hash-verifies the exact source, removes hidden
  layers, merges overlaps deterministically, orders pixels by row/column, stores a
  canonical private artifact, records its hash in Neon, and writes `.source.json`,
  `.canonical.json`, and generator-ready `.mjs` files.
- Added `docs/STORAGE_SETUP.md` with the two-bucket Cloudflare setup, environment
  variables, Prisma update, object layout, source retrieval, and export workflow.
- Added a canonicalization test covering hidden layers, overlap resolution, color
  normalization, and deterministic pixel ordering.
- Verification passed: Prisma client generation and schema validation, backend source
  and script TypeScript checks, 6 tests, and the production build.

## 2026-07-26 — Site metadata artwork

- Replaced the default/missing Next.js metadata artwork with the Circle collection art.
- Browser favicon and shortcut metadata use the existing crisp
  `/collection/legends/13-circle.svg`.
- Apple touch, Open Graph, and X/Twitter share metadata use the 1600×1600 `dps.png`,
  copied into `frontend/public` for direct serving.
- Added `NEXT_PUBLIC_SITE_URL` to the frontend environment example so production social
  image URLs resolve against the deployed website rather than localhost.
- Frontend TypeScript and the production build passed.

## 2026-07-26 — Discord sign-in, Render wake flow, and trait previews

- Changed Discord OAuth from a one-time verification step into persistent account
  recovery: a Discord ID already linked to a Mask Born Order profile now signs back
  into that exact profile and receives a fresh one-year session.
- Kept first registration ordered: a new Discord identity cannot create an orphaned
  Discord-only account and the Connect modal requires the X username to be saved first.
- Added a same-origin Next.js `/api/*` proxy for production. Render should set
  `NEXT_PUBLIC_API_URL` to the frontend URL, `BACKEND_URL` to the backend URL, and use
  the frontend `/api/auth/discord/callback` URL in Discord OAuth.
- Added a branded `/connect/discord` wake screen that polls the backend health endpoint
  while a free Render instance wakes, then automatically continues to Discord.
- Added stored preview variants for accessory submissions. Publishing Background,
  Eyes, Hats, and/or Special now creates every useful individual and combined preview
  over the canonical Maskborn base and stores the public variant URLs on the
  submission. One-of-one posts never receive these controls.
- Added responsive, horizontally scrollable trait boxes under public and profile
  creation cards. Creators and visitors can inspect a single submitted trait,
  combinations, or all submitted traits.
- Replaced the profile's mock submission rows with its real published creation cards
  and real vote totals.
- Added `docs/RENDER_SETUP.md` and corrected `docs/DISCORD_SETUP.md` for the proxy and
  production callback arrangement.
- Verification passed: Prisma validation, backend TypeScript/build and 7 tests;
  frontend TypeScript, ESLint, production build, and 16 tests.

## 2026-07-26 — Returning-member Discord login

- Added a distinct returning-member panel inside the Connect modal with “Log in with
  Discord” for profiles that have already completed registration and linked Discord.
- Kept the numbered X username, Discord verification, and wallet flow below it for new
  members, separated by a compact “New here?” divider.
- The returning login uses the same branded Render wake route and only recovers an
  existing linked Discord profile; an unknown Discord identity cannot bypass the
  registration flow.
- Added responsive modal styling for the new panel. Frontend TypeScript, ESLint, all
  16 tests, and the production build passed.

## 2026-07-26 — Compact account chooser and rounded favicon

- Replaced the tall returning-member section with a compact initial Connect view
  containing only two choices: “Have an account” and “Create account.”
- “Have an account” opens the existing Discord recovery login immediately. “Create
  account” reveals the normal X username, Discord, and wallet registration steps, with
  a small control to return to the account choices.
- On mobile the two choices stack into short rows, keeping the initial modal well
  within a small viewport.
- Preserved the original Circle artwork and created `/mbo-icon.svg` as a metadata-only
  copy clipped to rounded corners. The collection's source artwork remains square and
  unchanged.
- Frontend TypeScript, ESLint, all 16 tests, and the production build passed.

## 2026-07-27 — Trait voting, discovery controls, sharing, and navigation

- Fixed logout so the backend clears the production cookie with matching security
  attributes and the frontend immediately replaces the cached session with `{ user:
  null }`. The header, modal, profile, draw studio, and voting controls now update
  without a page refresh.
- Added nullable `category` fields and indexes to `Vote` and `VoteEvent`. Multi-trait
  posts require the voter to choose Background, Eyes, Hats, or Special; single-trait
  posts infer the category and 1/1 votes remain category-free.
- Public submission responses now include per-trait vote totals and the signed-in
  viewer's current vote. Cards and artwork detail pages restore vote state after a
  refresh and show a compact trait chooser before a multi-trait upvote or downvote.
- Added community search plus sorting by overall likes and selected-trait likes.
  Accepted Gallery, Profile submissions, Admin review queue, and collection samples
  also gained responsive search/sort controls appropriate to their data.
- Added per-artwork `generateMetadata` and a 1200x630 PNG Open Graph renderer with the
  artwork, title, creator, categories, and vote totals. Shared artwork links now open
  on a directly votable detail page and copy the URL when native sharing is absent.
- Added `ADMIN_DISCORD_IDS` as a backend allowlist. An allowlisted Discord callback
  promotes that profile to `ADMIN`; Admin then appears in the expanded desktop nav,
  mobile drawer, and Connect modal. Added `docs/ADMIN_SETUP.md`.
- Desktop navigation now contracts after scrolling and expands on hover/focus. The
  Menu drawer exists only below 800px. Added Collection to both navigation forms.
- Expanded normal generator previews from 16 to 48 using the JavaScript renderer and
  immutable dynamic SVG sample routes. Removed “Generated Maskborn” labels and changed
  carousel names to “Maskborn #…”.
- Updated `PLAN.md` for category-targeted votes and trait ranking.
- Verification passed: Prisma generation and validation, backend TypeScript/build and
  7 tests; frontend TypeScript, ESLint, production build, and 16 renderer tests.

## 2026-07-27 — Prisma publish lock and draft-save conflict fix

- Cast the PostgreSQL advisory transaction lock result to `text` so Prisma 7's Neon
  adapter no longer attempts to deserialize PostgreSQL's unsupported `void` type when
  publishing a submission.
- Added a bounded three-attempt retry with short linear backoff for Prisma `P2034`
  write conflicts around serializable draft-save transactions.
- Serialized draw-studio autosaves in the browser so a single tab does not send
  overlapping versioned draft updates; edits made during a save are queued by the
  next store update.
- Added unit coverage for retry success and non-retryable errors. Backend and frontend
  type checks, all 25 tests, and both production builds passed.

## 2026-07-27 — Empty artwork preview safety

- Prevented community and gallery artwork cards from reducing an empty
  `previewVariants` array. Submissions without generated trait previews now fall back
  to their main preview asset.
- Added regression coverage for empty and populated preview collections.
- Frontend TypeScript, ESLint, all 18 tests, and the production build passed.

## 2026-07-27 — Duplicate publish replay handling

- Preserved the `Submission(userId, mediaHash)` uniqueness rule while making repeat
  publishes content-idempotent across browser sessions and newly generated request
  keys. The API now returns the existing submission with HTTP 200 instead of leaking
  Prisma `P2002`.
- Rechecks the idempotency record after acquiring the per-user transaction lock, so
  rapid concurrent requests reuse the first committed response.
- Added bounded `P2034` retry protection to the serializable publish transaction.
- Backend TypeScript, all 9 tests, and the production build passed.

## 2026-07-28 — Guarded artwork reset script

- Added `backend/scripts/clear-artwork-data.js` and the `npm run clear:artwork`
  command. Its default mode is a read-only preview of submissions, votes, vote events,
  status events, accessory names, gallery entries, fee shares, and accruals.
- Destructive execution requires both `--execute` and the exact confirmation phrase
  `--confirm DELETE_ALL_ARTWORK`. It clears submissions and their cascading vote and
  artwork records, gallery/fee-share records, and stale publish/vote idempotency
  records in one transaction.
- The script refuses deletion when creator accruals exist and preserves drafts, users,
  applications, risk records, and object-storage files.
- JavaScript syntax and backend TypeScript checks passed. The Neon dry run succeeded
  and made no changes.

## 2026-07-28 — Accessory-name check throttling

- Changed draw-studio name availability checks to depend only on the active accessory
  name, category, active layer, local duplicate state, and verification state.
- Painting or erasing pixels no longer resets the label to “checking name” or sends
  repeated availability requests to the API.
- Frontend TypeScript, ESLint, and all 18 tests passed.

## 2026-07-28 — Draw, publish, and voting edge-case hardening

- No-op paint/erase operations and empty strokes no longer update timestamps, trigger
  autosaves, or add useless undo entries. Coordinates are boundary-checked, strokes
  undo as one action, layer IDs use UUIDs, and malformed persisted layers recover to a
  valid active layer with sanitized pixels.
- Empty unused layers no longer falsely consume an already-used trait slot. The client
  catches multiple drawn accessories in one category, reports name-check failures,
  and lets descriptions exceed 50 words visibly so the exact excess can be corrected
  before publishing.
- Submission previews are reconstructed server-side from validated pixel data and the
  trusted base SVG. A supplied SVG that differs from those layers is rejected instead
  of being stored, closing script/markup injection and preview/source mismatch paths.
- Extended the publish transaction timeout for R2 variance and added a specific
  `DATABASE_SCHEMA_OUTDATED` response for Prisma `P2021`.
- Serialized vote mutations per card/detail view to prevent rapid-click response
  races. Multi-trait pickers stay open until “Done,” allow independent trait votes,
  and tolerate an older API response with no `viewerVotes` array during deployment.
- Added regression tests for full-stroke history, invalid/no-op cells, Unicode name
  normalization, hidden layers, and trusted preview generation.
- Prisma schema diff against Neon was empty. Backend TypeScript, 11 tests, and build;
  frontend TypeScript, ESLint, 20 tests, and production build all passed.

## 2026-07-28 — Protected `/mboadmin` control room

- Replaced the frontend `/admin` page with `/mboadmin`; the old route is absent and
  returns the normal Next.js not-found page. Updated the admin-only header and account
  modal links.
- Added a client authorization gate that calls a fresh protected access endpoint
  before lazy-loading or rendering the dashboard. Unauthorized sessions are returned
  to the home page, while temporary backend failures reveal no admin content.
- Renamed the backend namespace from `/api/admin/*` to `/api/mboadmin/*`. Every route,
  including `/access`, remains behind verified-Discord and `ADMIN` role middleware.
- Marked the control-room page `noindex`, `nofollow`, and `nocache`, and updated admin,
  storage, and planning documentation.
- Added coverage proving the new access endpoint rejects unauthenticated requests and
  the old API namespace returns 404.
- Backend TypeScript, 12 tests, and production build; frontend TypeScript, ESLint, 20
  tests, and production build passed. The production route manifest contains
  `/mboadmin` and no `/admin` route.

## 2026-07-28 — Motion collection loaders

- Added a reusable four-dot Motion loader with staggered lift, scale, and opacity
  animation; the final dot uses the warm amber accent.
- Added full collection-fetch loaders to Community, Gallery, Profile submissions,
  artwork detail, and the admin review queue.
- Added a compact overlay loader to `PixelArtwork`, covering collection samples,
  carousel items, gallery art, submission cards, and profile artwork until each image
  actually finishes loading. Failed images stop the loader instead of spinning forever.
- The animation respects the operating system's reduced-motion preference and includes
  an accessible status label while keeping the visible design to dots only.
- Frontend TypeScript, ESLint, all 20 tests, and the production build passed.

## 2026-07-28 — Trait privacy, share previews, Discord diagnostics, and abuse controls

- Community artwork cards now label preview variants with generic trait categories
  such as Hats, Eyes, and All traits; submitted accessory names are shown only on the
  individual artwork page, where creators and voters have the detailed context.
- Added named preview switching to individual artwork pages, made the largest combined
  variant the safe default, and removed the internal `Submission #...` identifier.
- Share metadata renders the submission's real public preview artwork and uses a
  versioned, dynamic Open Graph image URL to avoid stale artwork after updates.
- Discord OAuth failures now return to a designed error state with actionable messages
  and safe server-side diagnostics. The state cookie uses top-level OAuth-compatible
  SameSite settings. Production config now validates that the callback uses the
  frontend/site origin and `/api/auth/discord/callback`, matching the Next.js API proxy;
  both Discord and Render setup guides were corrected.
- Added a protected `/mboadmin` abuse monitor that searches by user ID, display name,
  social username, or wallet; blank search shows recent risk signals and active
  restrictions. Queries are bounded, debounced, cancellable, and briefly cached.
- Admins can apply timed VOTE, SUBMISSION, or ACCOUNT restrictions and lift them.
  Admin accounts cannot be targeted, newer restrictions supersede older ones, all
  changes are audited, and ACCOUNT restrictions are enforced centrally across verified
  actions. The existing global rate limiter and client mutation locks remain in place.
- Backend TypeScript and 12 tests passed. Frontend ESLint, production build, and 21
  tests passed.

## 2026-07-28 — Proxy-safe Discord OAuth state

- Replaced Discord OAuth's separate state cookie with a short-lived state value signed
  using HMAC-SHA256 and the server-only signal pepper. This preserves CSRF protection
  while avoiding `invalid-state` failures when Vercel proxies OAuth requests to Render
  and the temporary backend cookie does not survive the round trip.
- State validation rejects malformed, tampered, differently signed, future-dated, and
  expired values using constant-time signature comparison. Legacy state cookies are
  still cleared after a successful callback.
- Added focused state security tests. Backend TypeScript, build, and 14 tests passed;
  frontend ESLint and production build passed.

## 2026-07-28 — Reliable Discord sessions and account-aware login

- Added an explicit dynamic Next.js `/api/[...path]` proxy that forwards API methods,
  query strings, request cookies, redirects, and response `Set-Cookie` headers between
  Vercel and Render. This replaces reliance on an external rewrite for the OAuth
  callback and makes the new session visible immediately on `/profile?discord=linked`.
- Discord OAuth state now carries a signed `login` or `link` intent. The “Have an
  account” button uses login-only mode: a Discord identity not already linked to a
  Mask Born account is rejected with a clear “No account linked; create one first”
  message instead of being silently attached to a partial session.
- The account-creation flow remains link mode, so a newly created X profile can link
  its Discord normally. Intent is covered by the same short expiry and HMAC tamper
  validation as the OAuth state. The no-account result includes a Create account
  action that returns home and opens the modal directly in its creation flow.
- Backend TypeScript, build, and 16 tests passed. Frontend ESLint, 21 tests, and the
  production build passed; the route manifest includes dynamic `/api/[...path]`.

## 2026-07-28 — Same-origin session fetching

- Removed `NEXT_PUBLIC_API_URL` from browser API routing. All client-side session,
  profile, mutation, health, and Discord-start requests now use the current website's
  `/api` origin, while only the server-side proxy reads `BACKEND_URL`. This prevents a
  Vercel-owned login cookie from being followed by an anonymous request sent directly
  to Render.
- Session queries now refetch whenever their consumers mount instead of treating a
  pre-OAuth anonymous result as fresh. Local frontend configuration now uses
  `BACKEND_URL=http://localhost:4000`; production and Discord docs no longer instruct
  setting a public backend API URL.
- Added Next's scroll-behavior marker, suppressed the known rewritten-path active-link
  hydration mismatch, and eagerly loads the first above-fold artwork to address the
  reported development warnings.
- Frontend ESLint, 21 tests, and the production build passed.

## 2026-07-28 — Submission-title uniqueness and duplicate audit

- Added global normalized title claims for artwork submissions. Case differences,
  repeated whitespace, and Unicode presentation variants now resolve to the same
  `Submission.titleClaim`; a debounced availability check gives immediate feedback
  in Draw, while the publish transaction and database unique constraint remain
  authoritative under concurrent requests.
- Publishing now returns `SUBMISSION_TITLE_TAKEN` with a clear instruction instead
  of a generic database error. Existing rows with nullable claims remain deployable,
  and their plain titles are also checked case-insensitively during publishing.
- Audited every Prisma uniqueness rule. Added specific conflict responses for
  wallets, X quote posts, applications, social identities, repeated artwork,
  votes, draft revisions, gallery entries, on-chain tokens/events, fee accruals,
  payouts, idempotent requests, slugs, and sessions. Compound targets work whether
  Prisma reports a constraint name or a field array.
- Fixed wallet linking so only an actual unique conflict is described as an already
  claimed wallet; database/service failures now propagate correctly. Application
  creation also handles concurrent duplicate profile or quote submissions.
- Prisma Client/schema validation, backend TypeScript/build and 17 tests, plus
  frontend ESLint, 21 tests, and production build all passed.

## 2026-07-28 — Unique X username claims

- Added a debounced X username availability endpoint and live feedback in the account
  modal. Invalid input is not queried; stale checks are aborted; transient check
  failures do not prevent the server from performing the authoritative save check.
- Account creation and username updates now reject an X username already linked to a
  different Mask Born account. A nullable unique `SocialAccount.claimKey` stores the
  normalized `x:<username>` claim, closing the concurrent-submit race at database
  level while leaving Discord identity uniqueness independent.
- Prisma Client was regenerated. Backend TypeScript, build, and 16 tests passed;
  frontend ESLint, 21 tests, and production build passed.

## 2026-07-28 — Partial trait gallery acceptance and mobile profile type

- Added an atomic admin action that reviews and adds a submission to the gallery in
  one transaction. For trait submissions, admins must select a non-empty subset of
  categories actually included in the work; they can accept one, several, or all.
  1/1 submissions are accepted as complete artwork.
- The review panel now shows selectable trait chips and changes its preview to the
  exact selected combination before acceptance. Previously accepted-but-not-promoted
  submissions remain visible in the queue so they can complete this flow.
- Public gallery responses derive their display image from the stored preview variant
  matching the accepted categories. This displays only accepted layers on the base,
  while 1/1 entries continue to display the complete submission preview.
- Reduced profile X username typography and avatar dimensions at tablet/phone
  breakpoints, added a zero-width-safe grid column, and enabled username wrapping.
- Backend TypeScript, build, and 16 tests passed. Frontend ESLint, 21 tests, and the
  production build passed.

## 2026-07-28 — Scalable list navigation and admin queue ordering

- Changed the protected review queue to bounded server-side pagination with a default
  12 submissions per page, a total count, full-dataset search across artwork and
  creator fields, and deterministic ordering by submission time or upvotes in either
  ascending or descending direction.
- Added a responsive reusable numbered paginator with first/last context, neighbouring
  pages, ellipses, disabled boundary controls, active-page state, and smooth return to
  the list when changing pages.
- Community submissions now use cursor-based batches of 24 with an explicit animated
  loading state and loaded-count feedback, avoiding the former hard stop at 60.
  Accepted gallery work uses the numbered paginator at 12 entries per view. Profile
  submissions remain unpaginated because account rules impose a small fixed maximum.
- Backend TypeScript, build, and 16 tests passed. Frontend ESLint, 21 tests, and the
  production build passed.

## 2026-07-28 — Accepted gallery card redesign

- Replaced the accepted gallery's irregular 12-column mosaic, whose mixed six/four
  column spans created holes on paginated pages, with a stable responsive grid: three
  equal cards on desktop, two on tablet, and one on phones.
- Cards now have consistent square artwork, restrained framed surfaces, lift/border
  hover feedback, readable number badges, min-width-safe metadata, responsive titles,
  and creator labels that do not distort column widths.
- Gallery numbering now continues across pages instead of restarting at 01.
- Frontend ESLint, 21 tests, and the production build passed.

## 2026-07-28 — Display-only accepted gallery

- Removed artwork-detail navigation from accepted gallery cards. Artwork, titles,
  traits, and card surfaces are now display-only on `/gallery`; only the creator's
  username links out to their X account.
- Removed card-level lift/click affordances and added a clear username-only hover
  treatment so the interaction model is visually honest.
- Frontend ESLint, 21 tests, and the production build passed.
