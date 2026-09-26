# Verso — Build Progress Tracker

Status legend: `[ ]` not started · `[~]` in progress · `[x]` done · `[-]` skipped/blocked

> Rule: a step is `[x]` only when its verification (test, `explain()`, smoke run) passed.
> After each **phase** completes, execution stops and waits for user review.

**Current status:** starting Phase 0
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
- [ ] 0.10 Author `DESIGN.md` from §13 "Ink & Parchment" (dimensional tokens, no Stitch)
- [x] 0.11 Create placeholder `theme/` files (colors/typography/spacing) from DESIGN.md — `mobile/src/theme/tokens.ts`
- [ ] 0.12 GitHub repo init (or remote setup), .gitignore, CI test workflow

**Phase 0 gate:** trivial backend + mobile tests pass locally; axios client unwraps envelope.

---

## Phase 0.5 — Architecture Foundation

- [ ] 0.5.1 Standard API response envelope (success/error shape)
- [ ] 0.5.2 Centralized error system (error classes, asyncHandler, global middleware) + unit tests
- [ ] 0.5.3 Structured logger (pino/winston) + request-id middleware + `LOGGING.md`
- [ ] 0.5.4 Env/config loader with fail-fast validation
- [ ] 0.5.5 Mongoose base config (connection options, timestamps plugin, toJSON transform)
- [ ] 0.5.6 Auth middleware skeleton (JWT verify, `req.user`)
- [ ] 0.5.7 Validation middleware (Zod/Joi) returning field-level 400s
- [ ] 0.5.8 Authorization helpers (`assertOwnerOrModerator`, etc.)
- [ ] 0.5.9 Redis shared client (cache + rate limit) with degradation docs
- [ ] 0.5.10 BullMQ foundation (queues, retries, backoff, dead-letter, worker error handler)
- [ ] 0.5.11 MongoDB indexes from §4 via migration/init script + verified
- [ ] 0.5.12 Socket.io JWT handshake auth + rejection logging
- [ ] 0.5.13 Rate limiter on auth endpoints only (429 + Retry-After)
- [ ] 0.5.14 Foundation integration tests (error envelope, config fail-fast, rate limiter blocks N+1)

**Phase 0.5 gate:** foundation tests green; all §4 indexes confirmed via `mongodb_collection-indexes`.

---

## Phase 1 — Auth & Users

- [ ] 1.1 User model + repository
- [ ] 1.2 RefreshToken model (token family + reuse detection) + indexes
- [ ] 1.3 Register endpoint (validation, bcrypt, tokens) + tests (409 dup, 400 weak password)
- [ ] 1.4 Login endpoint (401 without user enumeration) + tests
- [ ] 1.5 Refresh endpoint (rotation + family revoke on reuse) + reuse-detection test
- [ ] 1.6 Logout + log-out-everywhere endpoints
- [ ] 1.7 Wire auth middleware to real lookups + integration tests
- [ ] 1.8 Profile endpoints (get/update/photo upload, no mass-assign) + tests
- [ ] 1.9 Follow/unfollow (atomic $inc, 409 on dup) + tests
- [ ] 1.10 Mobile: register/login screens (field errors, SecureStore, loading, toast)
- [ ] 1.11 Mobile: profile screen (view/edit, photo, optimistic follow + rollback)
- [ ] 1.12 Mobile component tests for auth/profile loading/error states
- [ ] 1.13 MongoDB: verify unique indexes + `explain()` on refresh/follow hot paths

**Phase 1 gate:** integration tests for every endpoint (success + documented failures); component tests green.

---

## Phase 2 — Poems (Core Creation + Reading)

- [ ] 2.1 Poem + PoemVersion models
- [ ] 2.2 Create-poem endpoint (draft status) + field-level 400 test
- [ ] 2.3 Edit-poem (PoemVersion history, non-owner 403 test)
- [ ] 2.4 Delete-poem (soft-delete `status: "removed"`)
- [ ] 2.5 Get-poem (projection + visibility rules) + `explain()` check
- [ ] 2.6 Get-poem-versions (paginated)
- [ ] 2.7 Draft autosave endpoint (idempotent, no version spam)
- [ ] 2.8 Mobile: poetry editor (line-break textarea, word counter, debounced autosave, draft recovery)
- [ ] 2.9 Mobile: poem reading screen (skeleton, unavailable-state)
- [ ] 2.10 Tests: create/edit/delete/get/versions/autosave + index plan check

**Phase 2 gate:** tests green; `explain()` = IXSCAN on get-poem.

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
| — | — | — |
