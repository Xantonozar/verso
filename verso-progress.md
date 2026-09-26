# Verso — Build Progress Tracker

Status legend: `[ ]` not started · `[~]` in progress · `[x]` done · `[-]` skipped/blocked

> Rule: a step is `[x]` only when its verification (test, `explain()`, smoke run) passed.
> After each **phase** completes, execution stops and waits for user review.

**Current status:** Phase 2 complete — STOPPED for user review (Phase 2B next); repo pushed to Xantonozar/verso
**Last updated:** 2026-09-26

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

- [ ] 2B.1 Story + StoryVersion + StoryChapter models
- [ ] 2B.2 Lifecycle states defined (draft/published/unlisted/private_draft/under_review/removed)
- [ ] 2B.3 Story CRUD endpoints (metadata, chapters, reorder, publish, soft-delete, reads) + authz tests
- [ ] 2B.4 Story autosave (idempotent, explicit save = version snapshot)
- [ ] 2B.5 Mobile: story editor (metadata, cover, synopsis, chapters, reorder, preview, publish, draft recovery)
- [ ] 2B.6 Mobile: story reader (cover, chapters nav, progress, typography, unavailable state)
- [ ] 2B.7 Story in feed/discovery/search/profiles/collections/notifications/moderation + mixed-feed serializer
- [ ] 2B.8 Tests: chapter ordering, visibility, authz, autosave idempotency, publish validation, removed-story handling, resume position
- [ ] 2B.9 `explain()` sweep for story/chapter/discovery/search/author queries

**Phase 2B gate:** 2B.8 + 2B.9 pass.

---

## Phase 3 — Engagement

- [ ] 3.1 Reaction, FeltGoodRating, Comment, Save models + endpoints + validation (enum, 0–100 server-side)
- [ ] 3.2 Denormalized stat counters via atomic `$inc`
- [ ] 3.3 Unique-index constraints → clean 409s + PATCH update path
- [ ] 3.4 Mobile: reaction picker (optimistic + rollback), Felt Good slider, comment thread (nested, paginated), save toggle
- [ ] 3.5 Tests: toggle idempotency, out-of-range rejected, comment on removed poem rejected

**Phase 3 gate:** 3.5 green; counters grep-verified `$inc`-only.

---

## Phase 4 — Diary

- [ ] 4.1 DiaryEntry model + endpoints (reactions/comments only; no Felt Good route — router-enforced)
- [ ] 4.2 Integration test: diary never in mood/tag discovery
- [ ] 4.3 Mobile: diary composer (distinct from poem editor)

**Phase 4 gate:** 4.2 green.

---

## Phase 5 — Discovery & Feed

- [ ] 5.1 Mood/tag discovery endpoints using §4 compound indexes + `explain()` IXSCAN
- [ ] 5.2 Following-feed (indexed query + cursor pagination)
- [ ] 5.3 Trending as scheduled BullMQ job (denormalized + Redis TTL, duration logged)
- [ ] 5.4 Mobile: discovery screens (mood picker, tags, trending, random) + feed infinite scroll + distinct empty states
- [ ] 5.5 Load-test feed + trending; fix any COLLSCAN

**Phase 5 gate:** no COLLSCAN on hot paths; p95 within §10.21 budget.

---

## Phase 6 — Collections

- [ ] 6.1 Collection model + endpoints (+ CollectionItem TODO comment)
- [ ] 6.2 Mobile: collection create/browse + add/remove with optimistic update

**Phase 6 gate:** tests green.

---

## Phase 7 — Anonymous Layer

- [ ] 7.1 `anonymous` flag across Poem/Comment/Reaction (serializer strips identity for non-owner/non-mod)
- [ ] 7.2 Unsent Poem fields in creation flow
- [ ] 7.3 Mobile: anonymous toggle + inline explainer
- [ ] 7.4 Regression test: non-owner never receives real authorId (poem, comment, reaction, search)

**Phase 7 gate:** 7.4 green; serializer changes reviewed.

---

## Phase 8 — Collaboration

- [ ] 8.1 CollabPoem model + endpoints (server-side turn/line validation, append-only)
- [ ] 8.2 CollaborationPiece + CollaborationSegment (materialized path, atomic childCount cap: single=1 child, multi=configured max)
- [ ] 8.3 Segment-children endpoint + ReadingPath tracking (append-only)
- [ ] 8.4 Mobile: collab relay UI + branch picker + path breadcrumb
- [ ] 8.5 Race test: two simultaneous segment creates at cap → exactly one succeeds

**Phase 8 gate:** 8.5 green; `explain()` on ancestorPath/children queries.

---

## Phase 9 — Duels, Prompts, Remix

- [ ] 9.1 Duel + DuelVote models + endpoints (unique vote index, atomic $inc)
- [ ] 9.2 Prompt model + submission linking
- [ ] 9.3 Remix model + endpoint (original must be publicly readable)
- [ ] 9.4 Mobile: duel screen, weekly prompt, remix flow with attribution

**Phase 9 gate:** tests green.

---

## Phase 10 — Messaging

- [ ] 10.1 Conversation + Message models
- [ ] 10.2 Socket.io handlers + JWT connection auth + logging
- [ ] 10.3 REST history (cursor pagination)
- [ ] 10.4 Anonymous DM flag honored in BOTH REST and socket payloads (test both)
- [ ] 10.5 Mobile: DM inbox + chat (pending/sent/failed state, retry, anonymous toggle)
- [ ] 10.6 Offline-delivery test: socket message while offline appears via REST on next load

**Phase 10 gate:** 10.4 + 10.6 green; `explain()` on message history.

---

## Phase 11 — Notifications

- [ ] 11.1 Notification model (`readAt`)
- [ ] 11.2 BullMQ notification worker (poetic templates, idempotent jobs)
- [ ] 11.3 Expo push delivery from worker (delivery failures logged, don't fail job)
- [ ] 11.4 Mobile: notification list (mark-read on view, badge) + push permission explainer flow
- [ ] 11.5 Idempotency test: retried job doesn't duplicate notification

**Phase 11 gate:** 11.5 green; `explain()` on list query.

---

## Phase 12 — Analytics

- [ ] 12.1 Reading-activity logging endpoint (queued, never synchronous)
- [ ] 12.2 Writer analytics aggregation (profiled: job vs on-demand)
- [ ] 12.3 Mobile: writer dashboard (loading state, new-writer empty state)

**Phase 12 gate:** aggregation `explain("executionStats")` recorded.

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
