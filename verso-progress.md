# Verso — Build Progress Tracker

Status legend: `[ ]` not started · `[~]` in progress · `[x]` done · `[-]` skipped/blocked

> Rule: a step is `[x]` only when its verification (test, `explain()`, smoke run) passed.
> After each **phase** completes, execution stops and waits for user review.

**Current status:** Phase 12 complete — STOPPED for user review (Phase 13: Reading Streaks next); server + mobile pushed to Xantonozar/verso
**Last updated:** 2026-09-28

---

## Phase 0 — Project Setup

- [x] 0.1 Init backend Express project (`src/` structure), `.env` + `.env.example`, ESLint/Prettier, nodemon
- [x] 0.2 MongoDB Atlas connection via Mongoose (error handling + reconnect logging)
- [x] 0.3 Redis + BullMQ config (graceful degradation if Redis down) — Redis degradation verified (3s boot timeout, warn, API stays up); BullMQ queue definitions deferred to 0.5.10
- [x] 0.4 Cloudinary SDK config (upload failure → clean AppError) — unconfigured warn verified; AppError mapping lands with 0.5.2 error system
- [x] 0.5 Init Expo React Native project + React Navigation — done with **Expo Router** (project AGENTS.md mandates it over React Navigation); typecheck+lint+jest green
- [x] 0.6 Shared axios client (envelope unwrap, 401-refresh-retry, error normalization) — unwrap + error normalization tested (4 tests); 401 handler placeholder set, refresh-retry lands in Phase 1 with the refresh endpoint
- [x] 0.7 Shared mobile toast + loading/empty/error state components — component tests green (3 tests)
- [x] 0.8 Socket.io server attached to Express + connection logger — polling handshake 200 + sid verified
- [x] 0.9 Jest backend + Jest/RNTL mobile test runner (trivial test green) — server 3/3, mobile 7/7, `tsc --noEmit` clean, `expo lint` clean
- [x] 0.10 Author `DESIGN.md` from §13 "Ink & Parchment" (dimensional tokens, no Stitch) — markdown only (design-last per plan §8 step 92)
- [x] 0.11 Create placeholder `theme/` files (colors/typography/spacing) from DESIGN.md — `mobile/src/theme/tokens.ts`
- [x] 0.12 GitHub repo init (or remote setup), .gitignore, CI test workflow — CI (`.github/workflows/ci.yml`) + .gitignore + commits `0af2422` (Phase 0) + `1f11ea0` (Phase 0.5) pushed to `Xantonozar/verso`

**Phase 0 gate:** trivial backend + mobile tests pass locally; axios client unwraps envelope.

---

## Phase 0.5 — Architecture Foundation

- [x] 0.5.1 Standard API response envelope (success/error shape) — `src/middleware/respond.js` (ok/created/noContent), 404 funneled through error middleware
- [x] 0.5.2 Centralized error system (error classes, asyncHandler, global middleware) + unit tests — `src/errors/` + `asyncHandler` + `errorHandler` (Zod/Mongoose/CastError/11000/JSON-parse translation; prod strips stacks/internal messages) — 13 tests
- [x] 0.5.3 Structured logger (pino/winston) + request-id middleware + `LOGGING.md` — pino already wired; added `X-Request-Id` response echo + `server/LOGGING.md`
- [x] 0.5.4 Env/config loader with fail-fast validation — `src/config/env.js` (Zod schema, all 17 vars, distinct-JWT-secret check); boot fail-fast verified: `[FATAL] …JWT_ACCESS_SECRET: must be at least 32 characters`, exit 1 — 8 tests (replaces `loadEnv.js`)
- [x] 0.5.5 Mongoose base config (connection options, timestamps plugin, toJSON transform) — `src/models/base.js` `createSchema`/`refField` (timestamps on, versionKey off, `strip` list, `__v` removed) — 4 tests
- [x] 0.5.6 Auth middleware skeleton (JWT verify, `req.user`) — `requireAuth`/`optionalAuth` + `verifyAccessToken` (expired→AUTH_TOKEN_EXPIRED, forged/missing sub/wrong type→AUTH_INVALID_TOKEN; optionalAuth rejects present-but-invalid) — 12 tests
- [x] 0.5.7 Validation middleware (Zod/Joi) returning field-level 400s — `validate({body/query/params})`, parsed+stripped input replaces originals, query fields namespaced `query.x` — 4 tests
- [x] 0.5.8 Authorization helpers (`assertOwnerOrModerator`, etc.) — `assertOwner` (missing resource→404, wrong owner→403, anon→401), `assertOwnerOrModerator`, `assertAdmin`, `isModerator` — 10 tests
- [x] 0.5.9 Redis shared client (cache + rate limit) with degradation docs — client existed; added `server/REDIS.md` (degradation contract, two clients, fail-open policy) + Redis store w/ memory fallback in rate limiter — 3 degradation tests
- [x] 0.5.10 BullMQ foundation (queues, retries, backoff, dead-letter, worker error handler) — `src/jobs/{connection,options,queues,worker}.js`: 3 attempts + exponential 1s, lifecycle logging (enqueued/started/completed/retry/permanent), permanent→`verso:dead-letter`; pure-logic tests (no local Redis) — 8 tests
- [x] 0.5.11 MongoDB indexes from §4 via migration/init script + verified — `src/config/indexes.js` (14 indexes) + `scripts/init-indexes.js` run against `verso_dev`; **verified via mongodb MCP `collection-indexes`** (poems 3, follows 2, reactions unique, refreshtokens 2 sampled)
- [x] 0.5.12 Socket.io JWT handshake auth + rejection logging — `io.use()` accepts `auth.token` or Authorization header; rejections logged `socket:auth-rejected` with reason + `data.code` to client — 3 live-socket tests
- [x] 0.5.13 Rate limiter on auth endpoints only (429 + Retry-After) — 30 req/min per IP+method+path on `/api/v1/auth`; `X-RateLimit-*` + `Retry-After` headers; Redis (Lua INCR/PEXPIRE) → memory fallback → fail-open; 429 path tested end-to-end at app level
- [x] 0.5.14 Foundation integration tests (error envelope, config fail-fast, rate limiter blocks N+1) — 9 foundation suites; **full run: 69/69 green, lint clean**; boot smoke: health 200 + X-Request-Id, 404 envelope, Redis degraded warn, server stays up

**Phase 0.5 gate:** ✅ foundation tests green (69/69); all §4 indexes confirmed via `mongodb_collection-indexes`.

---

## Phase 1 — Auth & Users

- [x] 1.1 User model + repository — `src/modules/users/{model,repository}` + publicProfile serializer
- [x] 1.2 RefreshToken model (token family + reuse detection) + indexes — familyId/status/tokenHash indexes ensured via `scripts/init-indexes.js`
- [x] 1.3 Register endpoint (validation, bcrypt, tokens) + tests (409 dup, 400 weak password)
- [x] 1.4 Login endpoint (401 without user enumeration) + tests
- [x] 1.5 Refresh endpoint (rotation + family revoke on reuse) + reuse-detection test (401 AUTH_REFRESH_REUSED)
- [x] 1.6 Logout + log-out-everywhere endpoints
- [x] 1.7 Wire auth middleware to real lookups + integration tests — `requireAuth` hits real users; banned account → 403 ACCOUNT_BANNED
- [x] 1.8 Profile endpoints (get/update/photo upload, no mass-assign) + tests — allow-list displayName/bio/language; 5MB image-only multer
- [x] 1.9 Follow/unfollow (atomic $inc, 409 on dup) + tests — self-follow 400, dup 409, unfollow 404
- [x] 1.10 Mobile: register/login screens (field errors, SecureStore, loading, toast) — `(auth)/login|register` + AuthContext bootstrap/refresh wiring
- [x] 1.11 Mobile: profile screen (view/edit, photo, optimistic follow + rollback) — `(app)/profile` + `(app)/user/[id]` with rollback error toast
- [x] 1.12 Mobile component tests for auth/profile loading/error states — 9 auth-screen tests + 3 refresh-retry interceptor tests; **mobile 19/19 green, tsc 0, lint 0**
- [x] 1.13 MongoDB: verify unique indexes + `explain()` on refresh/follow hot paths — 17 indexes on `verso_dev`; `EXPRESS_IXSCAN tokenHash_1` + `IXSCAN followerId_1_followingId_1` ✓

**Phase 1 gate:** ✅ integration tests for every endpoint (success + documented failures) — server **135/135** across 14 suites; component tests green — mobile **19/19**; boot smoke `/health` 200, `/users/me` 401.

---

## Phase 2 — Poems (Core Creation + Reading)

- [x] 2.1 Poem + PoemVersion models — `src/modules/poems/{poem,poem-version}.model.js` (soft-delete `status`, `statsSchema`, optional `currentVersionId` ref)
- [x] 2.2 Create-poem endpoint (draft status) + field-level 400 test — `POST /api/v1/poems` (`status: draft`); publish deferred to Phase 3 by user decision
- [x] 2.3 Edit-poem (PoemVersion history, non-owner 403 test) — `PATCH /poems/:id` versions only on title/content change; `GET /poems/:id/versions` cursor pagination
- [x] 2.4 Delete-poem (soft-delete `status: "removed"`) — owner-only, reader hides removed poems (404)
- [x] 2.5 Get-poem (projection + visibility rules) + `explain()` check — optionalAuth, fail-closed 404, anonymous hides author/authorId; `explain()` = IXSCAN `_id_` ✓
- [x] 2.6 Get-poem-versions (paginated) — cursor = versionNumber desc, default 10, `explain()` = IXSCAN `poemId_1_versionNumber_-1` ✓
- [x] 2.7 Draft autosave endpoint (idempotent, no version spam) — `PUT /poems/:id/draft`, owner-only, non-draft → 409 `NOT_A_DRAFT`, `changed:false` no-op, never versions
- [x] 2.8 Mobile: poetry editor (line-break textarea, word counter, debounced autosave, draft recovery) — `components/PoemEditor.tsx` + `poem/new.tsx` + `poem/[id]/edit.tsx` + AsyncStorage draft recovery (`lib/poemDrafts.ts`)
- [x] 2.9 Mobile: poem reading screen (skeleton, unavailable-state) — `poem/[id].tsx` (skeleton, gone/error states, owner edit button, draft badge) + `+ New poem` on profile
- [x] 2.10 Tests: create/edit/delete/get/versions/autosave + index plan check — server **174/174** (38 new poem tests, lint 0); mobile **37/37** (18 new, tsc 0, lint 0); 18 indexes on `verso_dev` incl. `poemversions:poemId_1_versionNumber_-1`

**Phase 2 gate:** ✅ server 174/174 + mobile 37/37 + tsc/lint clean; `explain()` = IXSCAN on get-poem (`_id_`) and versions (`poemId_1_versionNumber_-1`).

---

## Phase 2B — Stories

- [x] 2B.1 Story + StoryVersion + StoryChapter models — `server/src/modules/stories/{story,story-chapter,story-version}.model.js`; 4 indexes ensured on `verso_dev` (22 total)
- [x] 2B.2 Lifecycle states defined (draft/published/unlisted/private_draft/under_review/removed) — `status` IS the lifecycle; visibility rules in `canView` (owner/mod always, published/unlisted public, fail-closed 404)
- [x] 2B.3 Story CRUD endpoints (metadata, chapters, reorder, publish, soft-delete, reads) + authz tests — 16 routes mounted at `/stories`; 2-phase reorder renumber (park + assign) to avoid unique-index collision; publish/unpublish validation + error codes shipped
- [x] 2B.4 Story autosave (idempotent, explicit save = version snapshot) — owner-only, `AUTOSAVABLE_STATUSES`, 409 `NOT_A_DRAFT` otherwise; `changed:false` no-op; PATCH versions only on real change
- [x] 2B.5 Mobile: story editor (metadata, cover, synopsis, chapters, reorder, preview, publish, draft recovery) — `StoryEditor` + `ChapterEditor` components (2s debounced autosave, local-draft recovery, preview, leave-with-unsaved-changes guard); screens `story/new`, `story/[id]/edit` (chapter list, ↑/↓ reorder with rollback, publish/unpublish), `chapter/[chapterId]/edit`
- [x] 2B.6 Mobile: story reader (cover, chapters nav, progress, typography, unavailable state) — `chapter/[chapterId]`: prev/next nav, "Chapter x of y" progress, reading position persisted to AsyncStorage ("Resume reading" on edit screen), fail-closed unavailable state
- [x] 2B.7 Profile story list + mixed-feed serializer (user-scoped: feed/discovery/search/collections/notifications integrations deferred to their phases) — `GET /users/:id/stories` (+404 `USER_NOT_FOUND`), `feed-item.serializer.js` (`type: poem|story|diary` discriminator + excerpt), profile "Stories" section + `+ New story`
- [x] 2B.8 Tests: chapter ordering, visibility, authz, autosave idempotency, publish validation, removed-story handling, resume position — server **254/254** (80 new story tests across 6 files, lint 0); mobile **61/61** (24 new, tsc 0, lint 0)
- [x] 2B.9 `explain()` sweep for story/chapter/discovery/search/author queries — 22 indexes on `verso_dev` (4 story); IXSCAN confirmed: `authorId_1_status_1_createdAt_-1` (profile list, winner), `storyId_1_chapterNumber_1` (chapter list)

**Phase 2B gate:** ✅ server 254/254 + mobile 61/61 + tsc/lint clean; reorder renumber fixed to 2-phase park+assign (unique-index collision); explain = IXSCAN.

---

## Phase 3 — Engagement

- [x] 3.1 Reaction, FeltGoodRating, Comment, Save models + endpoints + validation (enum, 0–100 server-side) — engagement module (9 files), 7 reaction types, 2-level comments, score REQUIRED 0–100 int, error codes `ALREADY_REACTED/ALREADY_RATED/FELT_GOOD_NOT_RATED/REPLY_DEPTH/TARGET_NOT_FOUND`
- [x] 3.2 Denormalized stat counters via atomic `$inc` — only mutation path `poemRepo.incStats` (`$inc` only), grep-verified for reaction/comment/save counters
- [x] 3.3 Unique-index constraints → clean 409s + PATCH update path — reaction/save idempotent 200, felt-good POST 409 + PATCH update (404 when never rated); comment content 1–500, soft-delete, batched replies
- [x] 3.4 Mobile: reaction picker (optimistic + rollback), Felt Good slider, comment thread (nested, paginated), save toggle — `components/engage/*` + reader BFF rewrite (`GET /mobile/poems/:id`) + poem publish/unpublish in edit screen; mobile gates 77/77 tests, `tsc --noEmit` 0, `expo lint` 0
- [x] 3.5 Tests: toggle idempotency, out-of-range rejected, comment on removed poem rejected — server 312/312 (engagement suite 58, lint 0); mobile 16 engagement tests incl. optimistic/rollback, debounce single-PATCH, pagination/reply/delete, publish lifecycle

**Phase 3 gate:** ✅ 3.5 green (server 312/312, mobile 77/77); counters grep-verified `$inc`-only.

---

## Phase 4 — Diary

- [x] 4.1 DiaryEntry model + endpoints (reactions/comments only; no Felt Good route — router-enforced) - `modules/diary/*` mounted at `/diary` (POST create, GET read; visibility public/followers, 1–280 chars, anonymous hide-identity), engagement generalized (`loadTarget(targetType…)`, diary reactions at `POST/DELETE /diary/:id/reactions`, comments via generic `/comments` with diary stats dispatch); felt-good/save/patch/delete diary routes → 404
- [x] 4.2 Integration test: diary never in mood/tag discovery - `tests/diary/discovery-isolation.test.js` (own collection, no moods/tags/title/status/feltGood schema paths, Phase 5 mood/tag query shapes match 0 diary docs, cross-id reads 404 both ways, `/users/:id/stories` excludes diary)
- [x] 4.3 Mobile: diary composer (distinct from poem editor) - `app/(app)/diary/new.tsx` (one-liner framing, 0/280 counter, public/followers segmented, raw TextInput + field/form errors), `lib/api/diary.ts`, profile `+ New diary` entry point; mobile gates 85/85 tests, `tsc --noEmit` 0, `expo lint` 0

**Phase 4 gate:** ✅ 4.2 green (discovery-isolation suite passes); server **339/339** across 32 suites + lint 0; mobile **85/85** + tsc/lint clean.

---

## Phase 5 — Discovery & Feed

- [x] 5.1 Mood/tag discovery endpoints using §4 compound indexes + `explain()` IXSCAN - `server/src/modules/discover/*` mounted at `/discover` (`GET /mood/:mood`, `/tags/:tag`, `/trending`, `/random`; cursor = ISO `createdAt`, limit 1..50); explain suite asserts IXSCAN present + COLLSCAN absent + exact index names (`moods_1_status_1_visibility_1_createdAt_-1`, `tags_1_status_1_createdAt_-1`) - 17 discovery tests
- [x] 5.2 Following-feed (indexed query + cursor pagination) - `GET /feed` (auth only: followees via `authorId_1_status_1_createdAt_-1`, visibility public/followers, batch author hydration, no-follows → empty page 200); 8 feed tests
- [x] 5.3 Trending as scheduled BullMQ job (denormalized + Redis TTL, duration logged) - `poems.trendingScore` + `{status, visibility, trendingScore:-1}` index; `jobs/trending.js` job scheduler every 5 min (logs `trending:refreshed` + `durationMs`/`records`, immediate first run, Redis-down → graceful skip); read path Redis `trending:global` EX 60 → denormalized-score Mongo fallback; formula `reads + reactions*3 + comments*2 + saves*2` over 7d window; 7 trending tests (stale-createdAt via native driver, empty-corpus `DISCOVER_EMPTY`)
- [x] 5.4 Mobile: discovery screens (mood picker, tags, trending, random) + feed infinite scroll + distinct empty states - `app/(app)/discover.tsx` (4 tabs w/ a11y `accessibilityRole="tab"`, tag chips derived from trending payload, manual tag entry, `DISCOVER_EMPTY` → own empty state with re-draw), `app/(app)/feed.tsx` + shared `components/PagedFeedList.tsx` (skeleton → items + `end` footer vs `empty` vs retryable error; reset = remount via `key`, no setState-in-effect), `Skeleton` (reduce-motion aware) / `FeedCard`, profile `Feed`/`Discover` entries (`open-feed`/`open-discover`); mobile **96/96** tests, `tsc` 0, `expo lint` 0
- [x] 5.5 Load-test feed + trending; fix any COLLSCAN - `tests/discover/load.test.js`: feed p50 4.0ms / p95 7.5ms, trending p95 4.7ms, mood p95 4.0ms (budget 400ms), zero COLLSCAN; full server suite **377/377** across 37 suites + lint 0

**Phase 5 gate:** ✅ no COLLSCAN on hot paths (explain IXSCAN + exact-index green); p95 far within §10.21 budget (feed 7.5ms, trending 4.7ms); server **377/377** (37 suites) + lint 0; mobile **96/96** + tsc/lint clean.

---

## Phase 6 — Collections

- [x] 6.1 Collection model + endpoints (+ CollectionItem TODO comment) - `server/src/modules/collections/*` mounted at `/collections` (`POST /`, `GET /`, `GET /:id`, `POST /:id/poems`, `DELETE /:id/poems/:poemId`); model mirrors diary (`ownerId`, title 1-80, description ≤300, visibility public/followers/private default public, `poemIds` + **§3.10a TODO** for `CollectionItem {collectionId, poemId, order, addedAt}` split, `{ownerId, createdAt: -1}` index); visibility matrix mirrors poem/diary (owner/mod, public, followers via Follow edge) with fail-closed 404 `COLLECTION_NOT_FOUND` (never 403 leak), mutations non-owner → 403 `FORBIDDEN`; add = `canView` poem eligibility (own drafts ok, others' drafts 404) + duplicate → 409 `POEM_IN_COLLECTION` (race via `poemIds: {$ne}` guard), remove → 204 / 404 `POEM_NOT_IN_COLLECTION`; `GET /:id` hydrates `poemIds` order, drops unviewable (keeps `poemCount`), batch authors, `serializeFeedItem` (anonymous → `author: null`); list = own-only cursor page; 23 collections tests
- [x] 6.2 Mobile: collection create/browse + add/remove with optimistic update - `lib/api/collections.ts`, `app/(app)/collections.tsx` (list + inline create form w/ title validation + visibility picker, `collections-*` testIDs), `app/(app)/collection/[id].tsx` (detail: hydrated poems, **optimistic remove with snapshot rollback** on failure), reader picker in `poem/[id].tsx` (bottom-sheet Modal: list w/ membership from `poemIds`, **optimistic toggle + inverse rollback**, in-flight guard vs double-press), profile `open-collections` entry; `collectionsScreens.test.tsx` **10 tests**; mobile **106/106** (10 suites), `tsc` 0, `expo lint` 0

**Phase 6 gate:** ✅ server **400/400** (38 suites) + lint 0; mobile **106/106** (10 suites) + tsc/lint clean.

---

## Phase 7 — Anonymous Layer

- [x] 7.1 `anonymous` flag across Poem/Comment/Reaction (serializer strips identity for non-owner/non-mod) - identity stripping verified across `poem.service.getPoem` (author **and** authorId), `serializeComment`, `serializeReaction` (never echoes userId), diary `serialize`, feed-item/discover/collection hydration (`author: null` for anonymous); stale "full anonymity hardening is Phase 7" comments in `poem.service`/`engagement.service`/`diary.service` replaced with pointers to the new regression suite
- [x] 7.2 Unsent Poem fields in creation flow - `isUnsentPoem`/`unsentRecipientLabel` added to `createPoemSchema` (create refine: label ⇒ flag true ⇒ 400), `createPoem` pass-through, `UPDATABLE_FIELDS`, `serialize()`; `updatePoem` coherence (flag off ⇒ stale label cleared, label while flag off ⇒ 400); 5 tests in `tests/poems/unsent-poem.test.js`
- [x] 7.3 Mobile: anonymous toggle + inline explainer - shared `components/ToggleRow.tsx` + `AnonymityExplainer.tsx` ("readers see no name/profile; **moderators can still see who wrote it**"); toggles in `PoemEditor` (anonymous + unsent + recipient label field), `CommentThread` composer, `ReactionBar`; API types gained `anonymous?`/`isUnsentPoem?`/`unsentRecipientLabel?` — fields only travel when toggled/changed so default payloads stay minimal
- [x] 7.4 Regression test: non-owner never receives real authorId (poem, comment, reaction, search) - `tests/anonymous/anonymity.test.js` (11 tests): deep-string scan of raw response bodies for the real id **and** username across poem detail (reader ✗ / owner ✓ / mod ✓), BFF `/mobile/poems/:id`, comment create/list/reply, reaction create (asserts DB still stores the real userId), diary detail, feed, discover-by-mood, collections hydration — every case has a positive control proving the scanner detects leaks; search leg deferred until the search endpoint ships (§6, no route yet)

**Phase 7 gate:** ✅ server **416/416** (40 suites) + lint 0; mobile **115/115** (11 suites) + tsc/lint clean.

---

## Phase 8 — Collaboration

- [x] 8.1 CollabPoem model + endpoints (server-side turn/line validation, append-only) - `server/src/modules/collab/collab-poem.model.js` (embedded turns array w/ TODO for 16MB split, `{status:1,createdAt:-1}` index) + service/controller/routes mounted at `/collab-poems` (`POST /`, `GET /` cursor list, `GET /:id`, `POST /:id/turns`, `POST /:id/finish`); line count derived server-side (strip one trailing newline only, CRLF normalized, interior blanks count), blank content 400, `LINE_COUNT_MISMATCH` with `details[0].field='content'`, order = `turns.length` (never client-trusted), turn-after-finish 409 `COLLAB_FINISHED`, non-creator finish 403, `requireAuth` fail-closed on every route
- [x] 8.2 CollaborationPiece + CollaborationSegment (materialized path, atomic childCount cap: single=1 child, multi=configured max) - piece carries `mode`/`maxBranches` (default 5, bounds 2-10, stored regardless of mode) + `rootSegmentId`; segment create materializes `ancestorPath`+`depth` and claims a branch slot via conditional `updateOne({_id: parentId, childCount: {$lt: cap}}, {$inc:{childCount:1}})` → matchedCount 0 = 409 `BRANCH_CAP_REACHED` (`details.cap`), `$inc -1` rollback if the segment insert then fails
- [x] 8.3 Segment-children endpoint + ReadingPath tracking (append-only) - `GET /collaborations/:pieceId/segments` (+ single-segment GET for breadcrumb resume), `.../segments/:segmentId/children` (returns `cap`), `POST+GET /:pieceId/reading-path`: legality via ancestorPath forward/backward walk (must start at root 400, disconnected 400 `PATH_NOT_CONNECTED`, re-post current = idempotent), upsert with `$push` only + unique `{userId:1,pieceId:1}`, `returnDocument:'after'`; indexes `{ancestorPath:1}`, `{pieceId:1,parentId:1}`
- [x] 8.4 Mobile: collab relay UI + branch picker + path breadcrumb - `lib/api/collab.ts` typed client, `collabs.tsx` hub (relay + piece lists with inline create forms), `collab-poem/[id].tsx` (open/finished indicator, live `N/M lines` counter with client pre-check, creator-only Finish, `countTurnLines` export), `piece/[id].tsx` (breadcrumb from `visitedSegmentIds` + 18-char crumb labels, branch picker, back-to-parent, composer with cap hint, first-visit path seeded at root), profile `open-collabs` entry; `collabScreens.test.tsx` **12 tests**; mobile **127/127** (12 suites), `tsc` 0, `expo lint` 0
- [x] 8.5 Race test: two simultaneous segment creates at cap → exactly one succeeds - `tests/collab/collaboration.test.js` race cases assert `[201,409]` exactly-one-wins + exact `childCount`; `explain()` **IXSCAN not COLLSCAN** on `pieceId_1_parentId_1`, `ancestorPath_1`, `userId_1_pieceId_1` (`tests/collab/explain.test.js`, 90 segments seeded); also fixed 3 latent createdAt seed order-flakes (story-list, discovery, feed) by seeding via native `Model.collection.updateOne`

**Phase 8 gate:** ✅ server **440/440** (43 suites) + lint 0; mobile **127/127** (12 suites) + tsc/lint clean; race test + `explain()` IXSCAN green.

---

## Phase 9 — Duels, Prompts, Remix

- [x] 9.1 Duel + DuelVote models + endpoints (unique vote index, atomic $inc) - `server/src/modules/duels/` (`duel.model`, `duel-vote.model`, service/controller/routes mounted at `/duels`); effective status derived from deadlines (`open`/`voting`/`closed`) serialized in every response; vote = phase check → conditional atomic `$inc` with deadline filter (matchedCount 0 → 409 `DUEL_CLOSED`) → `DuelVote.create` → 11000 → `$inc -1` rollback → 409 `DUPLICATE_VOTE`; vote response returns authoritative `{votes, myVote, status}`; create validates distinct existing published poems (404 `POEM_NOT_FOUND`, 400 `POEM_NOT_PUBLIC`, 400 `DUEL_SAME_POET`, zod refines `poemAId!==poemBId`, `votingDeadline>=submissionDeadline`), poets derived server-side; `GET /duels` cursor list + `GET /duels/:id` hydrated detail (`myVote`); unique `{duelId,userId}` index; 11 duel tests incl. **two parallel-vote race cases** (same user → sorted `[201,409]` tally 1; different users → `[201,201]` tally `{1,1}`)
- [x] 9.2 Prompt model + submission linking - `server/src/modules/prompts/` mounted at `/prompts`: `GET /current` = newest `weekOf<=now` (404 `NO_PROMPT`) + `mySubmission`; `POST /:id/submissions` own-published only (403 `FORBIDDEN`, 400 `POEM_NOT_PUBLISHED`, 404 `POEM_NOT_FOUND`), unique `(promptId,userId)` → 11000 = 409 `ALREADY_SUBMITTED`; submissions list = cursor + batch poems + per-row `canView` filter (no `authorId` leak, anonymous → `author:null`); `GET /poems/mine` added on poems module (before `/:id`, optional `status` enum, cursor) to power the picker; 12 prompt tests
- [x] 9.3 Remix model + endpoint (original must be publicly readable) - `server/src/modules/remixes/` mounted at `/remixes`: `assertOriginalReadable` (404 `POEM_NOT_FOUND`, 400 `ORIGINAL_NOT_PUBLIC` requester-independent incl. followers-only); flow = `createPoem` → `publishPoem` → `Remix.create` with rollback deletes (Poem, PoemVersion, Remix) on failure; zod blank-content refine, visibility enum; unique `{originalPoemId,remixPoemId}`; `getPoem` now returns `remixOf: String|null`; `serializeFeedItem` reused for `GET /poems/mine`; 6 remix tests; **server full run 469/469 (46 suites) + eslint 0**
- [x] 9.4 Mobile: duel screen, weekly prompt, remix flow with attribution - `lib/api/{duels,prompts,remixes}.ts` typed clients (`Poem.remixOf` added), `duel.tsx` (side-by-side board, settled/rollback vote + toast, duel-* testIDs, loading/ready/error/empty), `prompt.tsx` (prompt card, published-poem picker, submitted state, NO_PROMPT empty), `remix/[id].tsx` (attribution card before submit, title prefilled `X (remix)`, publish → `router.replace(/poem/:id)`), profile `open-duels`/`open-prompt` entries, reader `remix-poem`/`view-original` buttons; `competitionScreens.test.tsx` **15 tests** (vote settle/rollback/closed, prompt picker + ALREADY_SUBMITTED + empty states, remix attribution/prefill/validation/error, profile entries); mobile **142/142 (13 suites)**, tsc 0, expo lint 0. Note: mid-flight optimistic frame isn't observable in RNTL 14 (a press whose handler awaits a pending promise hangs `fireEvent`'s internal act — settled + rollback tests cover the contract instead)

**Phase 9 gate:** ✅ server **469/469** (46 suites) + eslint 0; mobile **142/142** (13 suites) + tsc/lint clean.

---

## Phase 10 — Messaging

- [x] 10.1 Conversation + Message models - `server/src/modules/messaging/{conversation,message}.model.js`: unique `pairKey` (sorted participant ids - avoids unique-index per-element collision), `participantIds` + `lastMessageAt` for inbox query, `{conversationId,createdAt:-1}` message index
- [x] 10.2 Socket.io handlers + JWT connection auth + logging - `sockets/index.js`: auto-join `user:{id}` room, `message:send`/`message:read` (zod-validated, ack `{ok,...}`), server→client `message:new`/`message:read`, logs `socket:message-sent`/`socket:message-rejected`; `sockets/registry.js` breaks require cycle
- [x] 10.3 REST history (cursor pagination) - `GET /conversations`, `GET /conversations/:id/messages?cursor&limit` (≤100), `POST /conversations/:id/messages`, `POST /conversations` get-or-create; single `serializeMessage` shared by REST + socket; non-participant → 404 `CONVERSATION_NOT_FOUND`
- [x] 10.4 Anonymous DM flag honored in BOTH REST and socket payloads (test both) - `senderId`/`sender` nulled when msg or thread anonymous; anonymous `message:read` receipt omits `readerId`
- [x] 10.5 Mobile: DM inbox + chat (pending/sent/failed state, retry, anonymous toggle) - `messages.tsx` + `chat/[id].tsx` + `lib/api/messaging.ts`; optimistic pending/sent/failed + retry, anon toggle (hidden + forced in anon threads), `profile` Messages entry, other-user `Message` button (get-or-create → chat)
- [x] 10.6 Offline-delivery test: socket message while offline appears via REST on next load - `tests/messaging/messaging.test.js` sends via socket A, disconnects, REST history on B returns it (19 messaging tests)

**Phase 10 gate:** 10.4 + 10.6 green; `explain()` IXSCAN on `conversationId_1_createdAt_-1` (no COLLSCAN); server **488/488** + eslint 0; mobile **155/155** + tsc/lint 0.

---

## Phase 11 — Notifications

- [x] 11.1 Notification model (`readAt`) - `modules/notifications/notification.model.js` (eventKey unique, `{userId:1, readAt:1, createdAt:-1}` index); producer wiring (reactions, comments, follows, collab turns, duel results) + `PUT /users/me/push-token`
- [x] 11.2 BullMQ notification worker (poetic templates, idempotent jobs) - `jobs/notifications.js` deterministic jobId=eventKey + `notifications.js` service/dispatcher; socket emit `notification:push`
- [x] 11.3 Expo push delivery from worker (delivery failures logged, don't fail job) - `deliverExpoPush` never throws; DeviceNotRegistered clears token; Redis-down → `{queued:false,reason:'redis-down'}`
- [x] 11.4 Mobile: notification list (mark-read on view, badge) + push permission explainer flow - `(app)/notifications.tsx` + profile entry button + `lib/api/notifications.ts`; 10 screen tests
- [x] 11.5 Idempotency test: retried job doesn't duplicate notification - `tests/notifications/notifications.test.js` 36 tests (duplicate eventKey → 1 row, no second socket emit)

**Phase 11 gate:** 11.5 green; `explain()` on list query IXSCAN on `userId_1_readAt_1_createdAt_-1`; server **524/524** + eslint 0; mobile **166/166** + tsc/lint 0.

---

## Phase 12 — Analytics

- [x] 12.1 Reading-activity logging endpoint (queued, never synchronous) - `POST /poems/:id/read` (optionalAuth + fail-closed `canView` 404) → `analytics.dispatcher` deterministic jobId=eventKey; `jobs/analytics.js` worker inserts + `$inc stats.reads` (insert gates the bump, §8.15), skips vanished/removed/self-reads; Redis-down → 200 `{queued:false}`
- [x] 12.2 Writer analytics aggregation (profiled: job vs on-demand) - `GET /analytics/writer` on-demand (explain profiled → indexed ms-range query beats queue+staleness at expected volume; revisit at p95 budget): reads/reactions/comments/saves/follower growth per day, zero-filled buckets, all-time totals; string-id `$match` in pipelines must be ObjectId-cast (mongoose doesn't cast aggregates - bucket tests caught it); indexes `readingactivities {authorId,createdAt}`, `follows {followingId,createdAt}`, `saves {poemId,createdAt}`
- [x] 12.3 Mobile: writer dashboard (loading state, new-writer empty state) - `(app)/analytics.tsx` (heavy-query loading, totals grid, newest-first day rows, quiet-window note, error+retry) + profile button + `lib/api/analytics.ts`; reader fires best-effort `recordPoemRead` once per mount; 7 screen tests

**Phase 12 gate:** aggregation `explain("executionStats")` recorded - IXSCAN on `authorId_1_createdAt_-1`, no COLLSCAN; server **541/541** (49 suites) + eslint 0; mobile **173/173** + tsc/lint 0.

---

## Phase 13 — Reading Streaks

- [ ] 13.1 Streak logic on poem-read (user-local timezone day, atomic)
- [ ] 13.2 Timezone edge test (11:58pm → 12:05am local extends streak)
- [ ] 13.3 Mobile: streak on profile + personal-best moment

**Phase 13 gate:** 13.2 green.

---

## Phase 14 — Moderation

- [ ] 14.1 Report + ModerationAction models + endpoints
- [ ] 14.2 Shared content-visibility scope helper (used by every read query)
- [ ] 14.3 Progressive enforcement (warning → restriction → ban → identity_revealed w/ audit log)
- [ ] 14.4 Mobile report flow (+ optional admin web panel → Playwright E2E if built)
- [ ] 14.5 Cross-module test: removed content never appears in list/feed/search endpoints

**Phase 14 gate:** 14.5 green; identity_revealed has audit entry test.

---

## Phase 15 — Hardening & Polish

### 15A — Stitch pipeline validation (7 screens)
- [ ] 15A.0 `stitch_create_project` (MOBILE) + upload `DESIGN.md` → design system + **user approval checkpoint**
- [ ] 15A.1 Shared set: toast, skeleton, empty-state, error-view, error-boundary
- [ ] 15A.2 Register
- [ ] 15A.3 Login
- [ ] 15A.4 Profile
- [ ] 15A.5 Poetry editor
- [ ] 15A.6 Poem reading
- [ ] 15A.7 Convert HTML/CSS → RN StyleSheet + real theme tokens; apply to app; visual check vs PNG
- [ ] 15A.8 **STOP — user review of 15A before continuing**

### 15B — Remaining screens (18)
- [ ] 15B.1 Discovery (mood picker, tags, trending, random)
- [ ] 15B.2 Following feed
- [ ] 15B.3 Story editor
- [ ] 15B.4 Story overview
- [ ] 15B.5 Story chapter reader
- [ ] 15B.6 Collections
- [ ] 15B.7 Collab poem (relay)
- [ ] 15B.8 Collab poem (open/branching)
- [ ] 15B.9 Duel
- [ ] 15B.10 Weekly prompt
- [ ] 15B.11 Remix creation
- [ ] 15B.12 DM inbox
- [ ] 15B.13 Chat
- [ ] 15B.14 Notifications list
- [ ] 15B.15 Push-permission explainer
- [ ] 15B.16 Writer dashboard
- [ ] 15B.17 Moderation: report flow
- [ ] 15B.18 Moderation: review queue (optional)

### 15C — Hardening
- [ ] 15C.1 Screen state audit (§7.3 loading/empty/error checklist)
- [ ] 15C.2 Endpoint error audit (§7.1 checklist, grep console.log/bare try-catch)
- [ ] 15C.3 Redis caching on hot read paths (TTLs per §10.7)
- [ ] 15C.4 `explain()` sweep on all §10.3 hot paths → fix COLLSCAN
- [ ] 15C.5 Full load test on staging
- [ ] 15C.6 Full regression (unit + integration + mobile) green
- [ ] 15C.7 Deploy (PM2, Nginx, SSL, Atlas prod, EAS build, logs queryable)
- [ ] 15C.8 Production smoke test (register, login, publish, react, refresh)

**Phase 15 gate:** all 15C items green; visual fidelity vs `.stitch/designs/*.png`.

---

## Phase-boundary checkpoint log

| Date | Phase completed | User reviewed? |
|---|---|---|
| 2026-09-26 | Phase 0 (incl. remote push) | yes |
| 2026-09-26 | Phase 0.5 (incl. remote push) | awaiting review |
| 2026-09-26 | Phase 1 (incl. remote push) | awaiting review |
| 2026-09-26 | Phase 2 (incl. remote push) | awaiting review |
| 2026-09-26 | Phase 2B (incl. remote push) | awaiting review |
| 2026-09-27 | Phase 3 (incl. remote push) | awaiting review |
| 2026-09-27 | Phase 4 (incl. remote push) | awaiting review |
| 2026-09-27 | Phase 5 (incl. remote push) | awaiting review |
| 2026-09-27 | Phase 6 (incl. remote push) | awaiting review |
| 2026-09-27 | Phase 7 (incl. remote push) | awaiting review |
