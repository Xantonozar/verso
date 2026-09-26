# Verso — Full Build Plan

A social poetry writing & reading platform. Mobile-only (Expo/React Native). Bangla/English support. This document is the complete build blueprint — architecture, schemas, and step-by-step implementation order — intended to be handed to an AI coding agent (or a human developer) to execute.

---

## 0. Tech Stack (Locked)

| Layer | Choice |
|---|---|
| Mobile | React Native (Expo) |
| Backend | Node.js + Express, single monolith (modular folder structure) |
| API style | REST, versioned (`/api/v1/...`) |
| Database | MongoDB (MongoDB Atlas) |
| Cache + Queue | Redis (BullMQ for jobs) |
| Real-time | Socket.io |
| Auth | JWT (access + refresh token) + bcrypt |
| Media storage | Cloudinary (audio, video, images) — uploads routed through Express, not direct-to-client |
| Push notifications | Expo push notifications |
| Hosting | VPS (Node + Redis) + MongoDB Atlas (managed) |
| Collaboration tree model | Materialized path |
| Search | MongoDB native indexes (no dedicated search engine in v1) |

No web app. No GraphQL. No microservices. No direct-to-storage client uploads. REST with a limited mobile aggregation/BFF-style layer allowed for complex screens (e.g. `/api/v1/mobile/poems/:id` aggregating poem + author + reactions + Felt Good + audio in one call). No app-wide rate limiting in v1, but basic Redis-based limits are required from day one on auth endpoints (register/login/refresh/forgot-password/OTP).

---

## 1. High-Level Architecture

```
React Native (Expo)
      │
      │ HTTPS (REST) + WebSocket
      ▼
Node.js / Express Monolith
      │
   ┌──┼──────────────┬─────────────┐
   ▼  ▼               ▼             ▼
MongoDB   Redis (cache+queue)   Cloudinary
(Atlas)         │                 (media)
                ▼
            Workers (BullMQ)
      (notifications, trending, analytics)
```

**Request flow rule:** anything the user is directly waiting on (create poem, post comment, react) writes to MongoDB and returns immediately. Anything secondary (notify others, recalculate trending, log analytics) goes through a Redis/BullMQ queue after the response is sent.

---

## 2. Backend Folder Structure

```
src/
├── config/              # env, db connection, cloudinary, redis config
├── modules/
│   ├── auth/
│   ├── users/
│   ├── poems/
│   ├── diary/
│   ├── comments/
│   ├── reactions/
│   ├── collections/
│   ├── discovery/
│   ├── feed/
│   ├── collaboration/
│   ├── duels/
│   ├── prompts/
│   ├── remix/
│   ├── messaging/
│   ├── notifications/
│   └── moderation/
├── jobs/                 # BullMQ queues + workers
├── middleware/           # auth, error handler, validation
├── sockets/               # Socket.io namespaces/handlers
└── app.js / server.js
```

Each module follows: `*.routes.js → *.controller.js → *.service.js → *.repository.js → *.model.js`. Controllers stay thin (parse request, call service, return response). Business logic and authorization checks live in the service layer.

---

## 3. MongoDB Schemas

### 3.1 User
```js
{
  _id: ObjectId,
  username: String,        // unique
  displayName: String,
  email: String,           // unique
  passwordHash: String,
  bio: String,
  profilePhotoUrl: String, // Cloudinary URL
  roles: {
    product: [String],     // ["poet", "reader", "curator"]
    security: String       // "user" | "moderator" | "admin"
  },
  language: String,        // "bn" | "en" | "both"
  followerCount: Number,   // denormalized
  followingCount: Number,  // denormalized
  readingStreak: {
    current: Number,
    longest: Number,
    lastReadDate: Date
  },
  moderation: {
    warningCount: Number,
    status: String,        // "active" | "restricted" | "banned"
    isAnonymizedAccount: Boolean
  },
  createdAt: Date,
  updatedAt: Date
}
```

### 3.1a RefreshToken
```js
{
  _id: ObjectId,
  userId: ObjectId,
  familyId: ObjectId,       // shared across all tokens descended from one login; rotates together
  tokenHash: String,        // never store raw token
  status: String,           // "active" | "rotated" | "revoked"
  replacedByTokenId: ObjectId, // set when rotated
  userAgent: String,
  ip: String,
  expiresAt: Date,
  createdAt: Date
}
// index on (familyId, status) — if a "rotated" or "revoked" token in a family is
// reused, revoke the entire family immediately (reuse-detection)
// index on userId for "log out everywhere"
```

### 3.2 Poem
```js
{
  _id: ObjectId,
  authorId: ObjectId,       // ref User — always the real author, even if anonymous
  title: String,
  content: String,          // line-break preserved
  authorNote: String,       // optional short context note
  language: String,         // "bn" | "en"
  moods: [String],          // ["sad", "hopeful", ...]
  tags: [String],
  visibility: String,       // "public" | "followers" | "unlisted" | "private_draft"
  anonymous: Boolean,
  isUnsentPoem: Boolean,
  unsentRecipientLabel: String,  // e.g. "Someone I lost" — optional
  audioUrl: String,         // Cloudinary URL, optional
  videoUrl: String,         // Cloudinary URL, optional
  status: String,           // "draft" | "published" | "hidden" | "removed" | "under_review"
  currentVersionId: ObjectId, // ref PoemVersion
  stats: {
    reads: Number,
    reactionCount: Number,
    commentCount: Number,
    saveCount: Number,
    shareCount: Number
  },
  createdAt: Date,
  updatedAt: Date,
  publishedAt: Date
}
```

### 3.3 PoemVersion
```js
{
  _id: ObjectId,
  poemId: ObjectId,   // ref Poem
  title: String,
  content: String,
  versionNumber: Number,
  editedAt: Date
}
```

### 3.4 DiaryEntry
```js
{
  _id: ObjectId,
  authorId: ObjectId,
  content: String,          // one-liner
  visibility: String,       // "public" | "followers"
  anonymous: Boolean,
  stats: {
    reactionCount: Number,
    commentCount: Number
  },
  createdAt: Date
}
```
Note: DiaryEntry is never returned by mood-based discovery queries. No Felt Good / star rating field exists on this model at all — reviews are poem-only.

### 3.5 Comment
```js
{
  _id: ObjectId,
  targetType: String,      // "poem" | "diary" | "collabSegment"
  targetId: ObjectId,
  authorId: ObjectId,
  anonymous: Boolean,
  parentCommentId: ObjectId, // for replies, null if top-level
  content: String,
  status: String,           // "active" | "hidden" | "removed"
  createdAt: Date
}
```

### 3.6 Reaction
```js
{
  _id: ObjectId,
  targetType: String,      // "poem" | "diary"
  targetId: ObjectId,
  userId: ObjectId,
  anonymous: Boolean,
  type: String,             // "loved" | "hurt" | "felt_this" | "powerful" | "comforting" | "dark" | "beautiful"
  createdAt: Date
}
// unique index on (targetType, targetId, userId, type)
```

### 3.7 FeltGoodRating
```js
{
  _id: ObjectId,
  poemId: ObjectId,
  userId: ObjectId,
  score: Number,            // 0-100 — "how much did this poem resonate with you?"
  comment: String,
  createdAt: Date,
  updatedAt: Date
}
// unique index on (poemId, userId)
```
Not a conventional 1-5 star review — Felt Good is a 0-100 resonance score, kept conceptually distinct from a star rating.

### 3.8 Follow
```js
{
  _id: ObjectId,
  followerId: ObjectId,
  followingId: ObjectId,
  createdAt: Date
}
// unique index on (followerId, followingId)
```

### 3.9 Save
```js
{
  _id: ObjectId,
  userId: ObjectId,
  poemId: ObjectId,
  createdAt: Date
}
// unique index on (userId, poemId)
```

### 3.10 Collection
```js
{
  _id: ObjectId,
  ownerId: ObjectId,
  title: String,
  description: String,
  visibility: String,       // "public" | "followers" | "private"
  poemIds: [ObjectId],      // ok to embed for v1; revisit as separate CollectionItem
                             // collection if any collection grows large (see §3.10a note)
  createdAt: Date,
  updatedAt: Date
}
```
Note: fine to embed for v1, but if power users build very large collections, split into a `CollectionItem { collectionId, poemId, order, addedAt }` collection rather than letting `poemIds` grow unbounded.

### 3.11 CollabPoem (fixed-turn collaboration)
```js
{
  _id: ObjectId,
  creatorId: ObjectId,
  title: String,
  linesPerTurn: Number,     // e.g. 4
  status: String,           // "open" | "finished"
  turns: [
    {
      authorId: ObjectId,
      lines: String,
      order: Number,
      createdAt: Date
    }
  ],
  createdAt: Date
}
```
No cap on turns/writers, no time limit — stays open indefinitely until explicitly marked "finished" by the creator. Since `turns` is an unbounded, indefinitely-growing embedded array, this is acceptable to start but should be split into a separate `CollabTurn { collabPoemId, authorId, lines, order, createdAt }` collection before any piece is expected to accumulate very large turn counts — a single MongoDB document has a 16MB hard limit.

### 3.12 CollaborationPiece (open/branching collaboration)
```js
{
  _id: ObjectId,
  creatorId: ObjectId,
  title: String,
  mode: String,             // "single_ending" | "multi_ending"
  status: String,           // "open" | "locked" | "complete"
  rootSegmentId: ObjectId,
  createdAt: Date
}
```

### 3.13 CollaborationSegment
```js
{
  _id: ObjectId,
  pieceId: ObjectId,        // ref CollaborationPiece
  parentId: ObjectId,       // null for root
  ancestorPath: [ObjectId], // materialized path: [rootId, seg2Id, ...] up to and including this segment's own ancestors (not itself)
  authorId: ObjectId,
  content: String,
  childCount: Number,       // denormalized, for enforcing branch cap
  depth: Number,
  createdAt: Date
}
// index on ancestorPath for fast subtree/path queries
// index on (pieceId, parentId) for fetching children of a node
```

### 3.14 ReadingPath
```js
{
  _id: ObjectId,
  userId: ObjectId,
  pieceId: ObjectId,
  visitedSegmentIds: [ObjectId], // in order, the path this reader chose
  currentSegmentId: ObjectId,
  updatedAt: Date
}
```
Note: same unbounded-array caveat as `CollabPoem.turns` — fine to embed for v1, but split into a `ReadingPathStep { readingPathId, segmentId, order, visitedAt }` collection if paths through long branching pieces get large.

### 3.15 Duel
```js
{
  _id: ObjectId,
  theme: String,
  poetAId: ObjectId,
  poetBId: ObjectId,
  poemAId: ObjectId,
  poemBId: ObjectId,
  submissionDeadline: Date,
  votingDeadline: Date,
  votes: {
    poemA: Number,
    poemB: Number
  },
  status: String,           // "open" | "voting" | "closed"
  createdAt: Date
}
```

### 3.16 DuelVote
```js
{
  _id: ObjectId,
  duelId: ObjectId,
  userId: ObjectId,
  votedFor: String,          // "A" | "B"
  createdAt: Date
}
// unique index on (duelId, userId)
```

### 3.17 Prompt
```js
{
  _id: ObjectId,
  text: String,
  weekOf: Date,
  featuredPoemIds: [ObjectId],
  createdAt: Date
}
```

### 3.18 Remix
```js
{
  _id: ObjectId,
  originalPoemId: ObjectId,
  remixPoemId: ObjectId,
  createdAt: Date
}
```

### 3.19 Message / Conversation
```js
// Conversation
{
  _id: ObjectId,
  participantIds: [ObjectId], // 2 for DM
  isAnonymous: Boolean,       // whole-thread anonymity flag
  lastMessageAt: Date,
  createdAt: Date
}

// Message
{
  _id: ObjectId,
  conversationId: ObjectId,
  senderId: ObjectId,         // always real user id, hidden client-side if anonymous
  content: String,
  isAnonymous: Boolean,
  readAt: Date,
  createdAt: Date
}
```

### 3.20 Notification
```js
{
  _id: ObjectId,
  userId: ObjectId,           // recipient
  type: String,                // "reaction" | "comment" | "follow" | "collab_turn" | "duel_result" | ...
  poeticMessage: String,       // rendered display text, e.g. "A poem is waiting for you tonight."
  relatedType: String,
  relatedId: ObjectId,
  readAt: Date,              // null = unread; cleaner than a bare Boolean
  createdAt: Date
}
```

### 3.21 Report
```js
{
  _id: ObjectId,
  reporterId: ObjectId,
  targetType: String,
  targetId: ObjectId,
  reason: String,
  status: String,             // "pending" | "reviewed" | "actioned" | "dismissed"
  createdAt: Date
}
```

### 3.22 ModerationAction
```js
{
  _id: ObjectId,
  userId: ObjectId,           // user actioned against
  actionType: String,         // "warning" | "restriction" | "ban" | "identity_revealed"
  reason: String,
  reportId: ObjectId,
  moderatorId: ObjectId,
  createdAt: Date
}
```

---

## 4. Indexing Plan

```js
// poems
{ authorId: 1, status: 1, createdAt: -1 }
{ moods: 1, status: 1, visibility: 1, createdAt: -1 }
{ tags: 1, status: 1, createdAt: -1 }

// comments
{ targetType: 1, targetId: 1, createdAt: -1 }

// reactions
{ targetType: 1, targetId: 1, userId: 1, type: 1 } // unique

// follows
{ followerId: 1, followingId: 1 } // unique
{ followingId: 1 } // for follower-count / feed queries

// collaborationSegments
{ ancestorPath: 1 }
{ pieceId: 1, parentId: 1 }

// messages
{ conversationId: 1, createdAt: -1 }

// notifications
{ userId: 1, readAt: 1, createdAt: -1 }

// feltGoodRatings
{ poemId: 1, userId: 1 } // unique

// refreshTokens
{ familyId: 1, status: 1 }
{ userId: 1 }
```

Use `explain()` during development to confirm `IXSCAN` not `COLLSCAN` on hot query paths (feed, discovery, profile).

---

## 5. API Endpoint Map (v1)

```
Auth (rate-limited via Redis from v1: register, login, refresh, forgot-password, OTP)
POST   /api/v1/auth/register
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh          # rotates token, revokes family on reuse detection
POST   /api/v1/auth/logout
POST   /api/v1/auth/forgot-password
POST   /api/v1/auth/otp/verify

Users
GET    /api/v1/users/:id
PATCH  /api/v1/users/me
POST   /api/v1/users/:id/follow
DELETE /api/v1/users/:id/follow

Poems
POST   /api/v1/poems
GET    /api/v1/poems/:id
PATCH  /api/v1/poems/:id
DELETE /api/v1/poems/:id
GET    /api/v1/poems/:id/versions
POST   /api/v1/poems/:id/reactions
POST   /api/v1/poems/:id/felt-good
POST   /api/v1/poems/:id/save
POST   /api/v1/poems/:id/read        # log reading activity, queued not synchronous

Mobile aggregation (limited BFF-style layer, additive to normal REST resources)
GET    /api/v1/mobile/poems/:id      # poem + author + reaction + Felt Good + audio in one call

Diary
POST   /api/v1/diary
GET    /api/v1/diary/:id
POST   /api/v1/diary/:id/reactions

Comments
POST   /api/v1/comments
GET    /api/v1/comments?targetType=&targetId=
DELETE /api/v1/comments/:id

Discovery / Feed
GET    /api/v1/feed
GET    /api/v1/discover/mood/:mood
GET    /api/v1/discover/trending
GET    /api/v1/discover/tags/:tag
GET    /api/v1/discover/random

Collections
POST   /api/v1/collections
GET    /api/v1/collections/:id
POST   /api/v1/collections/:id/poems
DELETE /api/v1/collections/:id/poems/:poemId

Collaboration
POST   /api/v1/collab-poems                       # fixed-turn
POST   /api/v1/collab-poems/:id/turns
POST   /api/v1/collab-poems/:id/finish

POST   /api/v1/collaborations                     # open/branching
POST   /api/v1/collaborations/:pieceId/segments
GET    /api/v1/collaborations/:pieceId/segments/:segmentId/children
POST   /api/v1/collaborations/:pieceId/reading-path

Duels
POST   /api/v1/duels
POST   /api/v1/duels/:id/vote

Prompts
GET    /api/v1/prompts/current
GET    /api/v1/prompts/:id/submissions

Remix
POST   /api/v1/remixes

Messaging (REST for history, Socket.io for real-time)
GET    /api/v1/conversations
GET    /api/v1/conversations/:id/messages
POST   /api/v1/conversations/:id/messages

Notifications
GET    /api/v1/notifications
PATCH  /api/v1/notifications/:id/read

Moderation
POST   /api/v1/reports
```

Socket.io events: `message:new`, `message:read`, `notification:push`, `collab:new_segment` (optional live notice).

---

## 6. Search Architecture (Write Path + Read Path)

Verso needs fast, "as-you-type"-feeling search across poems (title/content/tags), users (username/displayName), and collections — without a dedicated search engine in v1 (per §0/§9). This is achievable at Verso's expected scale using MongoDB's native text indexes plus a Redis-cached layer, as long as the write path and read path are both designed deliberately rather than left to "just query Mongo on every keystroke."

### 6.1 The core problem this section solves
A naive implementation — hit MongoDB with a fresh query on every character the user types — creates two failure modes: (a) the UI feels laggy because every keystroke round-trips to the database, and (b) MongoDB gets hammered with redundant, near-duplicate queries under real usage. The design below fixes both: **debounce + cancel on the client (read path)**, and **keep the index cheap to query by controlling what gets indexed and how on the write path**.

### 6.2 Write path — keeping the search index fast and correct
- **MongoDB text indexes**, created in Phase 0.5 alongside the other indexes in §4:
  ```js
  // Poem — weighted text index so title matches rank above body matches
  PoemSchema.index(
    { title: "text", content: "text", tags: "text" },
    { weights: { title: 5, tags: 3, content: 1 }, name: "poem_text_search" }
  );

  // User — search by username/displayName
  UserSchema.index(
    { username: "text", displayName: "text" },
    { weights: { username: 3, displayName: 2 }, name: "user_text_search" }
  );
  ```
- **Index only what's searchable, nothing more.** Don't add `content` to the text index for `draft`/`private_draft`/`removed` poems' visibility — the text index doesn't know about `status`/`visibility`, so every search query must also filter `status: "published"` and the visibility rule *after* (or combined with, via a compound `$and`) the `$text` match — never rely on the text index alone to hide non-public content (see 6.4).
- **Write-path rule: indexing is automatic, not a separate job.** Because these are native MongoDB text indexes on the `Poem`/`User` collections themselves, there's no separate "reindex" step to build or maintain per document — MongoDB updates the text index synchronously as part of the normal `save`/`update` write. This is the main advantage of native indexes over a dedicated search engine for v1: no index-sync lag, no separate ingestion pipeline to keep correct.
- **What still needs an explicit write-path step: search-suggestion/autocomplete data.** Full-text `$text` search isn't well-suited to prefix/autocomplete ("as you type") matching. For fast autocomplete (usernames, tags, poem titles), maintain a lightweight **Redis sorted-set-based prefix index** updated on write:
  - On user registration/username change → `ZADD autocomplete:usernames 0 <username>` (Redis sorted sets support efficient prefix range scans via `ZRANGEBYLEX`).
  - On poem publish/tag creation → `ZADD autocomplete:tags 0 <tag>` for each tag (dedup via `ZADD` being naturally idempotent for the same member).
  - This update happens in the same service-layer function that creates/updates the User or Poem — a few extra milliseconds on a write the user isn't watching closely, not a background job, since it must be immediately consistent (a user should be able to search for the username they just picked).
  - Tag/username removal (poem deleted, account deleted) should `ZREM` the corresponding entries — handle this in the same delete/deactivate service function, not forgotten as a stale-data source.
- **Search-relevant field changes must not silently skip the index.** Whichever service functions update `Poem.title`/`Poem.content`/`Poem.tags` or `User.username`/`User.displayName` are exactly the functions already responsible for the Redis prefix-index writes above — add an integration test that publishing a poem makes it findable by title within the same test (no eventual-consistency assumption needed for the core text index; explicit assertion for the Redis prefix index).

### 6.3 Read path — fast query serving
- **Two distinct query types, two distinct code paths — don't reuse one endpoint for both:**
  1. **Autocomplete/suggestions** (as the user types, before they hit "search"): `GET /api/v1/search/suggest?q=<prefix>&type=user|tag|poem` — reads from the Redis prefix index (`ZRANGEBYLEX`), returns a short list (5–8 items) in low-single-digit milliseconds. This is what powers the instant dropdown under the search bar.
  2. **Full search results** (after the user submits/pauses): `GET /api/v1/search?q=<query>&type=poems|users|all&cursor=<cursor>` — runs the MongoDB `$text` query with `$meta: "textScore"` sort, combined with the visibility/status filter from 6.4, using cursor pagination (§10.2) — never returns everything at once.
- **Client-side debounce + request cancellation (this is where most of the "feels fast" work actually lives):**
  - Debounce keystroke-triggered autocomplete calls by ~200–300ms so a fast typist doesn't fire a request per character.
  - Use axios's `AbortController` (or an equivalent cancel-token pattern) so that if a new keystroke fires a new request before the previous one resolves, the stale in-flight request is cancelled — otherwise a slow earlier response can race a fast later one and flash outdated results onto the screen. This is a concrete, testable bug class: write a mobile test that types "cat" then quickly "dog" and asserts only "dog" results ever render.
  - Full search submission (Enter/search-button tap) is not debounced — it fires immediately, since it's an explicit user action, not a per-keystroke one.
- **Redis result caching for repeat/popular queries:** cache the full-search response for a short TTL (e.g. 30–60s) keyed on `search:{type}:{normalized_query}:{cursor}`, since search terms cluster heavily around trending topics/names — this converts a repeated Mongo `$text` query into a Redis hit for the common case, per the general caching rule in §10.7. Autocomplete responses can be cached even more aggressively (they're prefix-keyed and change less per request).
- **Response payload stays small** (§10.2/§10.10): search results return only the fields a result card needs (id, title snippet, author subset, thumbnail) — never the full poem body — consistent with the general response-size rule elsewhere in this document.
- **Empty/loading/error states specifically for search** (extends §6.3's general mobile rule): a genuinely empty result set ("no poems found for 'x'") is a distinct state from "still typing/loading" — don't flash an empty state mid-debounce before the request has even fired.

### 6.4 Search must respect visibility, moderation, and anonymity — always
This is a correctness requirement, not a performance one, but it belongs here because it must be built into the query on both paths from day one, not bolted on later:
- Every search query — both `$text` search and the Redis-cached read — filters out `status: "removed"`/`"under_review"` poems and `private_draft`/`unlisted` visibility (unless the requester is the owner), using the same shared visibility-scope query helper introduced in Phase 14 (§7 step 88) so this logic is defined once and reused, not reimplemented per search type.
- Anonymous poems/authors are searchable by content, but a search result for an anonymous poem must go through the same response-serializer identity-stripping used everywhere else (§7 step 60) — never leak `authorId` in a search-result payload just because it came from a different query path than the normal poem-detail endpoint.
- Banned/restricted users' content follows the same moderation-status exclusion as feed/discovery (§7 step 91) — search is not a backdoor around content that's been actioned elsewhere.
- Add this as an explicit integration test: create a `private_draft` poem containing a distinctive word, search for that word as a different user, assert zero results; search as the owner, assert it appears.

### 6.5 Why not a dedicated search engine (and when to revisit)
MongoDB native text search is the right choice for v1 given the stated no-dedicated-search-engine decision (§0) and Verso's expected early-stage query volume — it avoids running/syncing a second datastore (Elasticsearch/Meilisearch/Algolia) before there's real load to justify the operational cost. The known limitations to watch for: `$text` search doesn't do fuzzy/typo-tolerant matching, doesn't rank as well as a purpose-built engine on large corpora, and Bangla-script tokenization quality with MongoDB's default text index should be spot-checked during Phase 5 (§7 step 53) — if Bangla search quality proves poor, that's the concrete trigger to revisit Meilisearch (lightweight, self-hostable, good multilingual support) rather than a speculative early adoption. Document this as a known trade-off rather than a gap nobody decided on.

---

## 7. Cross-Cutting Standards (apply in every phase below)

These are not a one-time phase — every single endpoint and every mobile screen built in every phase must satisfy all of the following. Phase 0.5 builds the shared infrastructure; every phase after that is required to *use* it, not reinvent it.

### 7.1 Backend error handling (every endpoint, no exceptions)
- Every controller action is wrapped so thrown/rejected errors reach the centralized error-handling middleware — never a bare `try/catch` that silently swallows an error, and never an unhandled promise rejection.
- Use custom error classes (e.g. `AppError`, `ValidationError`, `NotFoundError`, `AuthError`, `ConflictError`, `RateLimitError`) with a stable `code`, an HTTP `statusCode`, and a human-readable `message`. Business logic throws these; it never returns `null`/`false` and expects the caller to guess why.
- The global error middleware is the only place that: logs the error, decides the response shape, and strips stack traces/internal details from the client response in production (full detail in dev).
- Every response — success or error — follows the standard envelope from Phase 0.5, e.g.:
  ```js
  // success
  { success: true, data: {...}, meta: {...} }
  // error
  { success: false, error: { code: "POEM_NOT_FOUND", message: "Poem not found", details: {...} } }
  ```
- Validation errors (Joi/Zod) are caught by the validation middleware before hitting the controller and returned as `400` with a field-level breakdown (`{ field: "title", message: "Title is required" }` per invalid field), never a generic "bad request."
- Mongoose errors are translated, not leaked: duplicate key (`11000`) → `409 ConflictError` with a clear message (e.g. "username already taken"); `CastError` on a bad ObjectId → `400`; `ValidationError` → `400` with field breakdown.
- Async route handlers use a wrapper (e.g. `asyncHandler(fn)`) so you never need repeated `try/catch` boilerplate per controller.
- 404 vs 403 vs 401 are used correctly and consistently: 401 = not authenticated, 403 = authenticated but not authorized, 404 = resource doesn't exist (or is hidden from this requester — decide per-module whether "not visible" should leak as 404 to avoid enumeration, e.g. for `private_draft` poems and blocked users).
- External service failures (Cloudinary upload failure, Redis unavailable, BullMQ job enqueue failure) are caught explicitly and degrade gracefully where possible (e.g. if Redis cache is down, fall through to MongoDB rather than 500ing the whole request) — never let an optional dependency take down a critical path.

### 7.2 Backend logging (structured, from Phase 0.5 onward)
- Use a structured logger (e.g. `pino` or `winston`) — never bare `console.log` in application code once Phase 0.5 is done.
- Log levels used consistently: `error` (something broke, needs attention), `warn` (recovered but noteworthy — e.g. rate limit hit, cache miss fallback), `info` (normal lifecycle events — server start, job completed, user registered), `debug` (verbose, dev-only, off in production).
- Every request gets a request-id (generated or propagated from a header) attached to the logger context so all logs for one request can be correlated.
- Log every unhandled error with: request id, route, user id (if authenticated), error code, stack trace (server-side only, never sent to client).
- Log every BullMQ job's lifecycle: enqueued, started, completed, failed (with retry count), and permanently failed → dead-letter.
- Never log secrets: passwords, tokens (access/refresh), full card/payment data if that's ever added, raw OTP codes.
- Production logs are shipped somewhere queryable (even just structured stdout captured by the VPS process manager/log rotation is acceptable for v1 — no need for a dedicated log aggregation service yet, but keep logs structured JSON so one could be added later without a rewrite).

### 7.3 Mobile error handling & user feedback (toasts/banners)
- Every API call from the mobile app goes through the shared axios client (Phase 0) whose response/error interceptors: (a) unwrap the standard success/error envelope, (b) trigger silent access-token refresh on a `401` from an expired token before retrying once, (c) surface a consistent error object to calling code (`{ code, message }`), (d) force logout + redirect to auth screen if refresh itself fails (reuse-detected/revoked family).
- A single shared toast/snackbar system (e.g. a lightweight custom toast component or a library such as `react-native-toast-message`) is built in Phase 0 and reused everywhere — no screen invents its own inline error text pattern.
- Toast rules, applied consistently:
  - Network/timeout errors → toast: "Couldn't connect — check your connection" with a retry affordance where the action is safely retryable.
  - Validation errors returned from the API → inline field-level errors on the form (not a toast) whenever the error maps to a specific input; a toast only for whole-request failures with no single field to blame.
  - Auth errors (expired session after failed refresh) → toast: "Session expired, please log in again" + redirect, not a silent failure.
  - Success feedback for meaningful actions (poem published, comment posted, follow succeeded) uses a brief, low-friction toast — not a blocking modal — except for destructive/irreversible actions (delete poem, leave collab), which get a confirm dialog before the action and a toast after.
  - Optimistic UI actions (reaction tap, save toggle) update instantly and silently roll back with a toast only if the server call ultimately fails — never block the UI waiting on the network for these.
- Every screen that fetches data implements three explicit states beyond the happy path: loading (skeleton, not a blank screen or spinner-only for content-heavy screens like feed/discovery), empty (a real empty state with a next action, e.g. "No poems yet — write your first one", not a blank list), and error (a retry-capable error view for full-screen failures, not just a toast that leaves the screen stuck blank).
- Crashes/unexpected JS errors are caught by a top-level React error boundary that shows a recoverable "something went wrong" screen with a restart action, rather than a white screen or app crash.

### 7.4 Testing requirements (per phase, not deferred to the end)
- **Unit tests** (Jest): every service-layer function with business logic (validation rules, authorization checks, stat-counter math, materialized-path construction, streak calculation, token rotation/reuse-detection logic) gets unit tests covering the happy path, at least one expected-failure path, and relevant edge cases (empty input, boundary values, already-exists conflicts).
- **Integration tests** (Jest + Supertest against a test MongoDB instance, e.g. `mongodb-memory-server`): every new endpoint gets at least one test for the success case, one for each documented error case (401/403/404/409/400 as applicable), and one for the auth/ownership boundary (user A cannot edit user B's poem, etc.).
- **Regression habit**: every bug found during manual testing or in production gets a failing test written first that reproduces it, then the fix, confirming the test now passes — this test stays in the suite permanently so the bug cannot silently return.
- **Contract stability**: response-shape tests (or a schema snapshot) for core read endpoints (`GET /poems/:id`, `GET /feed`, `GET /users/:id`) so an accidental field rename/removal breaking mobile is caught in CI, not in production.
- **Load/perf checks** (from §10): for endpoints flagged as hot paths (feed, discovery, trending), an `explain("executionStats")` check is run and recorded as part of that phase's completion — not postponed to Phase 15.
- **Mobile**: critical user flows (register→login, create poem→publish, react/comment/save, follow/unfollow) get at least a basic component/interaction test (e.g. React Native Testing Library) verifying the UI calls the right API function and renders loading/success/error states correctly with mocked responses.
- No phase is considered "done" until: its endpoints have integration test coverage, its service functions have unit test coverage, its mobile screens have the loading/empty/error states from §7.3, and manual smoke-testing of the happy path plus at least one deliberately-broken input has been done.

---

## 8. Build Order (Step by Step)

Every step below is implicitly governed by §7 — error handling, structured logging, toasts/loading-empty-error states, and tests are not listed redundantly under every single line item, but are required for every endpoint and screen built.

### Phase 0 — Project Setup
1. Init Express project (`src/` structure per §3), configure `.env` + `.env.example`, ESLint/Prettier, `nodemon` for dev.
2. Set up MongoDB Atlas cluster (dev + prod clusters/databases separated) + connection via Mongoose, with connection-error handling and reconnect-on-drop logic logged at `warn`/`error`.
3. Set up Redis instance (local for dev, VPS Redis for prod) + BullMQ config; verify connection failure is logged and doesn't crash the whole server (degrade: disable caching, keep core API up).
4. Set up Cloudinary account + SDK config; verify upload failure paths return a clean `AppError`, not a raw SDK exception.
5. Init Expo React Native project, configure navigation (React Navigation), set up the shared axios API client with request/response interceptors (auth header injection, envelope unwrapping, 401-refresh-retry, error normalization — see §7.3).
6. Build the shared mobile toast/snackbar system and the shared loading/empty/error state components (skeleton loader, empty-state view, retry-capable error view) — every later screen reuses these, never reimplements them.
7. Set up Socket.io server instance, attach to Express HTTP server; add a basic connection/disconnection logger.
8. Set up Jest (backend) and the mobile test runner (Jest + React Native Testing Library); confirm a trivial test passes in CI/locally before building features, so testing infrastructure isn't an afterthought.

### Phase 0.5 — Architecture Foundation
Build this before any feature module (including User), so every later module follows the same patterns instead of the AI agent inventing conventions per-module:
9. Standard API response envelope (success/error shape, §7.1) used by every endpoint.
10. Centralized error system: custom error classes, `asyncHandler` wrapper, global error-handling middleware that logs (§7.2) and shapes the response per §7.1. Write unit tests for the error classes and middleware itself (correct status codes, correct envelope shape, stack trace stripped in prod mode).
11. Structured logger setup (pino/winston), request-id middleware, log-level conventions documented in a short `LOGGING.md` so later phases follow them consistently.
12. Environment/config loader — validates required env vars at boot, fails fast with a clear log message (not a cryptic crash) if something required is missing.
13. Mongoose base configuration: connection options, shared schema plugins (timestamps, toJSON transform that strips `__v`/internal fields), consistent ObjectId/ref handling.
14. Authentication middleware skeleton (JWT verification, `req.user` attachment) — wired to real lookups once `User`/`RefreshToken` exist in Phase 1.
15. Validation middleware (Joi or Zod) that runs before controllers and returns field-level `400`s per §7.1.
16. Authorization/policy foundation — reusable ownership/role-check helpers (e.g. `assertOwnerOrModerator(resource, user)`) used across modules instead of ad hoc `if` checks scattered per controller.
17. Redis connection module (shared client for both caching and rate limiting), with a documented graceful-degradation behavior if Redis is unreachable.
18. BullMQ foundation: queue/worker base setup, shared job options (retry count, exponential backoff, dead-letter queue for permanently-failed jobs), and a worker-level error handler that logs failures with job id + attempt count (§7.2).
19. Create the MongoDB indexes from §5 up front via a migration/init script, not per-module as an afterthought; verify each with `explain()` once relevant collections have data.
20. Socket.io authentication foundation (JWT-based handshake auth), with connection-rejection logging for failed auth attempts.
21. Basic Redis-based rate limiter middleware applied to auth endpoints only (register/login/refresh/forgot-password/OTP); returns `429` with a clear `RateLimitError` and a `Retry-After` header.
22. Write integration tests for the foundation itself: a deliberately-thrown error returns the correct envelope; a request missing required env-driven config fails predictably in test mode; the rate limiter actually blocks the (N+1)th request in a window.

### Phase 1 — Auth & Users
23. Build `User` model + repository.
24. Build `RefreshToken` model (§4.1a) — token family + reuse detection.
25. Build register endpoint: validate input (email format, password strength, username uniqueness) → bcrypt hash password → create `User` → issue access + refresh tokens → log `info` "user registered" (no PII beyond user id in the log). Unit test: duplicate email/username returns `409`; weak password returns `400` with field detail.
26. Build login endpoint: verify credentials, issue tokens, log `info` on success and `warn` on repeated failed attempts (candidate hook for future brute-force protection). Unit test: wrong password returns `401` without revealing whether the email exists (avoid user enumeration).
27. Build refresh-token endpoint: verify + rotate; if the presented token's status is `rotated` or `revoked` (reuse detected), revoke the entire token family and force re-login, logging a `warn`-level "refresh token reuse detected" event since this is a possible compromise signal. Unit test explicitly covers the reuse-detection path.
28. Build logout endpoint (revoke the current refresh token/family) and, separately, a "log out everywhere" action (revoke all families for the user).
29. Wire the Phase 0.5 auth middleware to real `User`/`RefreshToken` lookups; integration test that a request with an expired/invalid access token is rejected and a request with a valid one attaches `req.user` correctly.
30. Build profile endpoints (get/update profile, upload profile photo via Cloudinary — handle upload failure per §7.1). Validate updatable fields explicitly (never mass-assign the whole request body into the User document).
31. Build follow/unfollow endpoints with atomic `$inc` on `followerCount`/`followingCount` (§10.19) — never a read-then-write count update. Unique-index conflict (already following) returns a clean `409`, not a raw Mongo error.
32. Mobile: auth screens (register, login) with field-level validation errors, secure token storage (Expo SecureStore), auth context/state, loading state on submit, toast on network failure, redirect-on-success.
33. Mobile: profile screen (view/edit, photo upload with progress/error state), follow/unfollow button with optimistic count update and rollback-on-failure toast.
34. Write integration tests for every endpoint above (success + each documented failure case) and component tests for the auth screens' loading/error states before moving to Phase 2.

### Phase 2 — Poems (Core Creation + Reading)
35. Build `Poem` + `PoemVersion` models.
36. Build create-poem endpoint: validate required fields, create `Poem` in `draft` status, log `info`. Unit test: missing title/content returns field-level `400`.
37. Build edit-poem endpoint: authorization check (only the author can edit, or a moderator per §7.1's ownership helper), creates a new `PoemVersion`, updates `currentVersionId` and the read-optimized `title`/`content` cache fields on `Poem` — never mutate history destructively. Integration test: non-owner edit attempt returns `403`.
38. Build delete-poem endpoint (soft-delete via `status: "removed"`, not a hard Mongo delete, so it can be excluded from public reads per §8/§9 while remaining recoverable by moderators).
39. Build get-poem endpoint: returns current version + stats via a projection (§10.2), respecting `visibility` (private_draft/unlisted/followers/public) against the requester's relationship to the author.
40. Build get-poem-versions endpoint (paginated, not the full history dumped at once).
41. Build draft autosave endpoint — debounced client-side, idempotent server-side (repeated autosave calls with identical content shouldn't create redundant `PoemVersion` entries; only publish/explicit-save creates a version).
42. Mobile: poetry editor screen — line-break aware textarea, live word/line counter, debounced autosave with a subtle "saving… / saved" indicator (not a toast for every autosave tick — toast only on autosave *failure*), draft-recovery on reopen.
43. Mobile: poem reading screen — loading skeleton while fetching, graceful handling of a poem that's been removed/hidden/gone-private since the link was shared (clear "this poem is no longer available" empty state, not a raw error).
44. Integration + unit tests for create/edit/delete/get/versions/autosave before moving on; explain()-check the get-poem query against the index plan in §5.


### Phase 2B — Stories (First-Class Long-Form Content)
35B. Build `Story`, `StoryVersion`, and `StoryChapter` models. Stories are a first-class publishing type, not a renamed poem editor. A story can contain multiple ordered chapters, each with its own draft/version history, while the Story document stores read-optimized metadata such as title, cover, synopsis, status, visibility, tags, author, chapter count, and current publication state.
36B. Define story lifecycle states explicitly: `draft`, `published`, `unlisted`, `private_draft`, `under_review`, `removed`. Reuse the same visibility/moderation rules as poems where appropriate, but do not force story-specific chapter data into the poem schema.
37B. Build story CRUD endpoints: create story, update metadata, create/update/reorder chapters, publish/unpublish, delete/soft-delete, fetch story detail, fetch paginated chapter list, fetch a chapter, and fetch version history. Only the owner or authorized moderator may mutate a story.
38B. Build story autosave. Autosave chapter content and metadata independently, debounce on the client, make the server operation idempotent, and never create a permanent version for every autosave tick. Explicit save/publish creates a version snapshot.
39B. Build the mobile story editor as a dedicated long-form writing experience: story title, cover selection, synopsis, tags, chapter list, chapter editor, autosave status, word count, chapter reorder, preview, publish controls, validation, draft recovery, and unsaved-change protection. Do not simply reuse the poem editor with a different label.
40B. Build the mobile story reading experience: cover, title, author, synopsis, chapter navigation, previous/next chapter controls, progress/reading position, typography optimized for long-form reading, reactions/comments/save/share, and graceful handling when a story or chapter becomes unavailable.
41B. Add story support to feed, discovery, search, profiles, collections, notifications, moderation, analytics, and sharing wherever the product rules allow it. Mixed feeds must identify whether an item is a poem, story, or diary entry without ambiguity.
42B. Add story-specific integration/component/E2E tests: chapter ordering, chapter visibility, owner authorization, autosave idempotency, publish validation, removed-story handling, reader chapter navigation, resume-reading position, and mixed-feed serialization.
43B. Run the same MongoDB `explain()`/index verification for story reads, chapter reads, discovery, search, and author pages before declaring the story phase complete.

### Phase 3 — Engagement
45. Build `Reaction`, `FeltGoodRating`, `Comment`, `Save` models + endpoints, each with its own validation (reaction `type` enum, Felt Good `score` 0–100 range-checked server-side not just client-side, comment length limits).
46. Wire denormalized stat counters on `Poem` (`reactionCount`, `commentCount`, `saveCount`) using atomic `$inc` on create/delete of the corresponding document — never a separate `COUNT()` query per read (§10.17/§10.19).
47. Enforce the unique-index constraints (one reaction of a given type per user per target, one Felt Good rating per user per poem) as clean `409 "already reacted"` / `already rated"` responses, with an explicit "update your existing rating" path (`PATCH` not duplicate `POST`) rather than surfacing the raw Mongo duplicate-key error.
48. Mobile: reaction picker (optimistic tap → instant visual state → rollback + toast only on failure), Felt Good slider (0–100) with debounced submit, comment thread UI (nested replies via `parentCommentId`, paginated, loading-more state), save button (optimistic toggle).
49. Integration tests: reaction/save toggle idempotency, Felt Good score out-of-range rejected server-side even if the mobile client's slider is theoretically bypassed, comment on a removed/hidden poem is rejected.

### Phase 4 — Diary
50. Build `DiaryEntry` model + endpoints (reactions/comments only — no Felt Good route exists for diary at all, enforced at the router level so it's not just a documentation convention).
51. Confirm at the query layer (integration test, not just code review) that diary entries never surface from any mood/tag discovery endpoint.
52. Mobile: diary posting UI, visually distinct from the poem editor (shorter composer, one-liner framing), same shared toast/loading/error components as everywhere else.

### Phase 5 — Discovery & Feed
53. Build mood/tag discovery endpoints using the compound indexes from §5; verify with `explain()` that these hit `IXSCAN`.
54. Build basic following-feed endpoint (indexed query + cursor pagination per §10.2/§10.3).
55. Build trending calculation as a scheduled BullMQ job (§10.6) — never computed synchronously on request; store the score both denormalized on `Poem` and cached in Redis with a short TTL; log job duration and record count for observability.
56. Mobile: discovery screens (mood picker, tag browse, trending list, random) — infinite-scroll with FlashList/FlatList (§10.11), skeleton loading, "you've reached the end" and "nothing here yet" empty states distinguished from each other.
57. Load-test the feed and trending endpoints (§10.22) before calling this phase done; fix any `COLLSCAN` found.

### Phase 6 — Collections
58. Build `Collection` model + endpoints; enforce the §4.10 note (flag, don't yet build, the `CollectionItem` migration path — just leave a code comment/TODO referencing it so a future phase can act on it if collections grow).
59. Mobile: collection creation/browsing UI, add/remove-poem flow with optimistic update.

### Phase 7 — Anonymous Layer
60. Add `anonymous` flag handling across Poem, Comment, Reaction creation — server always stores the real `authorId`/`userId`; the response *serializer* (not the raw document) strips identity when `anonymous: true` and the requester isn't the owner or a moderator. Write a specific integration test that a non-owner, non-moderator request never receives the real author id in the payload for anonymous content, since this is a privacy-sensitive path worth its own explicit regression test.
61. Build Unsent Poem fields on the poem creation flow.
62. Mobile: anonymous toggle on poem/comment/reaction composer UI, with a brief inline explainer of what stays hidden vs. what moderators can still see (avoid a false sense of total anonymity — this is also a trust/safety concern, not just a UX one).

### Phase 8 — Collaboration
63. Build `CollabPoem` model + endpoints (fixed-turn): validate turn order and line-count-per-turn server-side (never trust client-declared line counts); append-only turn creation.
64. Build `CollaborationPiece` + `CollaborationSegment` models: materialized-path construction on segment creation, `childCount` cap enforcement in `single_ending` mode (exactly one child) vs `multi_ending` (configured max), enforced atomically to avoid a race where two simultaneous requests both pass the cap check.
65. Build the segment-children endpoint (for the reader's branch picker) and `ReadingPath` tracking (§4.14) — append-only path updates.
66. Mobile: collab poem UI (relay writing, clear "whose turn"/open-ended indicator), open collab UI (branch picker at fork points, path history breadcrumb).
67. Integration tests specifically for the concurrency edge case in step 64 (two near-simultaneous segment-creation requests against the same parent at the branch cap — exactly one should succeed).

### Phase 9 — Duels, Prompts, Remix
68. Build `Duel` + `DuelVote` models + endpoints; enforce one vote per user per duel via the unique index, atomic `$inc` on `votes.poemA`/`votes.poemB`.
69. Build `Prompt` model + submission linking.
70. Build `Remix` model + endpoint (validates the original poem exists and is publicly readable before allowing a remix link).
71. Mobile: duel screen (side-by-side poems + voting, optimistic vote with rollback), weekly prompt screen, remix creation flow (clear attribution to the original shown before submit).

### Phase 10 — Messaging
72. Build `Conversation` + `Message` models.
73. Build Socket.io namespace/handlers for real-time delivery, connection auth via JWT (using the Phase 0.5 socket-auth foundation) — log connection/auth-failure events.
74. Build REST endpoints for conversation history (initial load + cursor pagination — never load full message history at once, §10.2).
75. Wire the anonymous DM flag through both the REST history endpoints and the socket payloads consistently (a common bug class: anonymity honored in one path, leaked in the other — write a test that checks both).
76. Mobile: DM inbox, chat screen (optimistic send with a pending/sent/failed state per message, retry-on-failure affordance, not a silent drop), anonymous DM toggle.
77. Integration test: a Socket.io message delivered while the recipient is offline still shows up via the REST history endpoint on next load (no message loss across the two delivery paths).

### Phase 11 — Notifications
78. Build `Notification` model (`readAt` field, §4.20).
79. Build the BullMQ worker that creates notifications from queued events (reaction, comment, follow, collab turn, duel result) using a poetic-phrase template library; ensure job idempotency (§10.15) so a retried job doesn't create duplicate notifications for the same event.
80. Wire Expo push notification delivery from the worker; handle and log push-delivery failures (invalid/expired push token) without failing the whole job.
81. Mobile: notification list screen (mark-as-read on view, unread-count badge), push permission request flow with a clear explanation before the OS prompt (better opt-in rate) and a graceful path if permission is denied (in-app notifications still work).

### Phase 12 — Analytics
82. Build the reading-activity logging endpoint — queued via BullMQ, never synchronous on the read request itself (§10.18).
83. Build writer analytics aggregation (BullMQ job or on-demand query, whichever profiling shows is cheaper at expected volume) — reads, reactions, comments, saves, follower growth over time.
84. Mobile: writer dashboard screen with clear loading state for what may be a heavier aggregate query, and a sensible empty state for brand-new writers with no data yet.

### Phase 13 — Reading Streaks
85. Build streak update logic (triggered on poem-read event) on `User.readingStreak`; handle timezone edge cases explicitly (define streak "day" in the user's local time, not server UTC, to avoid off-by-one streak breaks) and cover this with a dedicated unit test (read at 11:58pm local, then 12:05am local, should extend the streak — write the test that pins this behavior down).
86. Mobile: streak display on profile, with a small celebratory moment on new personal-best (non-blocking, not a toast — a subtle in-place animation is fine, but keep it out of scope if time-constrained).

### Phase 14 — Moderation
87. Build `Report` + `ModerationAction` models + endpoints.
88. Build moderation status checks into content-visibility queries (`status: "removed"` excluded from all public reads) — add this as a shared query helper/scope used by every module's read queries, not reimplemented per-module (a missed spot here is a real content-leak bug class).
89. Build progressive enforcement logic (warning count → restriction → ban → identity reveal) as an admin-triggered or semi-automated flow; the `identity_revealed` action specifically requires an explicit moderator confirmation step and its own audit log entry (§14) given how sensitive it is.
90. Mobile (or a lightweight admin web panel, optional): report button on content with a reason picker, moderator review queue.
91. Integration tests: a `removed` poem/comment never appears in any list/feed/search endpoint (this is worth a dedicated cross-module test sweep, not just a per-module check).

### Phase 15 — Hardening & Polish
92. Apply the Material You "Ink & Parchment" design system consistently across all screens (a visual pass, done last so it's applied to a functionally complete app rather than iterated on repeatedly mid-build). Design source-of-truth is `DESIGN.md` (§13), generated/exported from Stitch. Stitch's native export is HTML/CSS — this must be converted to React Native `StyleSheet`/theme constants (not pasted in as web markup) before being applied to any screen. See §12 for the screen inventory and §13 for tokens.
93. Audit every screen against the §7.3 loading/empty/error-state checklist; fix any screen that still shows a blank flash or unhandled spinner.
94. Audit every endpoint against the §7.1 error-handling checklist; grep the codebase for any remaining bare `console.log`/unwrapped `try/catch`/un-normalized error response and fix.
95. Add/confirm Redis caching on all hot read paths (trending, popular profiles, poem-detail) with TTLs per §10.7.
96. Run `explain()` against every hot query path listed in §10.3 and fix anything still resolving to `COLLSCAN`.
97. Run the full load test suite (§10.22) against a staging environment sized close to production; fix whatever bottleneck it surfaces (don't scale infrastructure first — optimize first, per §10.23).
98. Full regression pass: run the entire automated test suite (unit + integration + mobile component tests) and require it green before deploy; manually smoke-test every Phase's core flow end-to-end on a real device.
99. Deploy: VPS setup (Node process manager e.g. PM2, Nginx reverse proxy, SSL), MongoDB Atlas production cluster, Cloudinary production config, production env vars validated by the Phase 0.5 config loader, Expo production build (EAS) for iOS/Android, and confirm structured logs are actually reaching somewhere queryable in production before calling the deploy complete.
100. Post-deploy smoke test against production itself (register, login, publish a poem, react, refresh) before considering the release done.

---

## 9. Explicit Non-Goals for v1

- No app-wide rate limiting in v1 (add post-launch once abuse patterns are visible) — but basic Redis-based limits on auth/OTP endpoints ship from day one
- No dedicated search engine
- No web app
- No GraphQL. REST with a limited mobile-specific aggregation/BFF-style layer is allowed for complex screens
- No direct-to-Cloudinary client uploads
- No line-level highlighting, no synchronized audio, no video poems (later phases)
- No auto-translation between Bangla/English

---

## 10. Performance & Scalability Requirements

> Performance is a cross-cutting requirement, not a Phase-15 concern. Every feature must be implemented with efficient MongoDB queries, appropriate indexes, projections, cursor pagination, minimal API payloads, avoidance of N+1 queries, Redis caching where justified, and BullMQ for expensive secondary work. No feature should introduce unbounded document growth or expensive synchronous computation on user-facing requests. Measure before optimizing, and verify hot paths with `explain("executionStats")` and realistic load testing.

**8.1 Core rule** — every feature is designed around: fast API response + minimal data transfer + efficient MongoDB query + caching where useful + async secondary processing.

**8.2 API performance**
- Return only required fields — use `.select()` projections, not full documents.
- Cursor pagination everywhere; never return huge arrays.
- Run independent queries in parallel (`Promise.all`), never sequentially when they don't depend on each other.
- Cache hot read endpoints with Redis.

**8.3 MongoDB performance** — proper single/compound indexes, projections, cursor pagination, `explain("executionStats")` on hot paths (feed, trending, discovery, profile, comments, messages, notifications) targeting `IXSCAN` not `COLLSCAN`. Avoid unnecessary `populate()` and unbounded document growth.

**8.4 No N+1 queries** — especially in feeds. Batch: fetch N poems, then fetch all needed authors/reactions/saves in one query each (not per-poem), then map in memory. Use aggregation pipelines where that's actually cheaper than batched lookups.

**8.5 Feed** — following feed = indexed query + cursor pagination + Redis cache. Don't compute recommendation scores per-request; precompute via BullMQ worker → Redis/Mongo → fast read API.

**8.6 Discovery (Trending/Rising/Hidden Gems/New Voices)** — never scan-and-score on request. Engagement events → BullMQ worker → derived scores stored → Redis → `GET /discover/trending` just reads the cache.

**8.7–8.8 Redis caching & invalidation** — cache expensive, frequently-requested, relatively stable data (`poem:{id}`, `user:{id}`, `trending:global`, `trending:{mood}`, `discover:new-voices`, `popular:collections`) with TTLs matched to freshness needs (trending = short, static categories = long). On writes, update Mongo then invalidate/update the relevant Redis key; derived data (trending) recomputes async via BullMQ rather than synchronously.

**8.9 Connections** — proper MongoDB connection pool and Redis client reuse; never open a new connection per request.

**8.10 Response-size optimization** — poem detail responses return only the fields the screen needs (id, title, content, author subset, stats); comments/versions/analytics get their own paginated endpoints, never inlined wholesale.

**8.11 Mobile (React Native) performance** — FlatList/FlashList for large lists, cursor pagination, image caching/resizing, lazy loading, memoization, debounced search, optimistic UI for lightweight interactions, skeleton states. Never mount hundreds of items at once — render a visible/buffer window and load more on scroll.

**8.12 Image optimization** — use Cloudinary on-the-fly transformations to serve appropriately sized images (thumbnail/feed/full) rather than sending originals to mobile.

**8.13 Audio/video** — load metadata only in feeds; stream audio/video only on play, never preload every poem's media.

**8.14 Background jobs** — any secondary effect (notification, analytics, recommendation, trending update) goes through BullMQ after the primary response is sent, never blocking user-perceived latency.

**8.15 Queue reliability** — workers need retry, backoff, dead-letter/failed-job handling, and idempotency (a retried job must not create duplicate notifications/analytics records).

**8.17 Counters** — maintain denormalized `stats` counters on Poem (reads, reactionCount, commentCount, saveCount, shareCount) updated server-side; Mongo interaction documents remain the source of truth.

**8.19 Concurrency** — use atomic operations (`$inc`, transactions where needed) for reaction/follow/save/Felt Good/collab-branch-creation counters — never read-modify-write in application code, which loses updates under concurrent requests.

**8.20 Monitoring** — track API/Mongo/Redis/queue latency, worker failures, memory/CPU, request/error rate. Watch p95/p99, not just the average — a healthy average can hide a broken tail.

**8.21 Performance budgets (targets, not hard guarantees)** — simple cached read: very fast; simple DB read: ~100–200ms; feed/discovery: ~200–400ms; write operation: ~100–300ms. Measure under realistic load, not localhost.

**8.22 Load testing** — before production, load-test feed, poem reading, comments, reactions, login, notifications, messaging, and discovery under concurrent requests; find CPU/memory/query/Redis/queue/connection-pool bottlenecks and fix the actual bottleneck found.

**8.23–8.24 Scaling path** — optimize before scaling (measure → find bottleneck → optimize → load test → scale infra only if still needed). Initial: 1 Node + 1 Redis + MongoDB Atlas + BullMQ workers. Growing: load balancer across Node instances behind shared Redis/workers/Atlas. Later (only if needed): dedicated workers, dedicated search, advanced feed/recommendation infra, media processing infra, DB scaling.

**How this changes the build order (§7):** don't defer performance to Phase 15. Phase 0.5 already includes the Redis/BullMQ/index foundation. Within every subsequent phase, follow: schema → indexes → query design → pagination → API response size → caching if justified → load test. Phase 15 (§7, "Polish") becomes performance *hardening*, not the first time performance is considered.

---

## 12. UI Screen Inventory (for Stitch)

Stitch generates one screen at a time. This list is what the Stitch skill reads for context per screen — a one-line content description, not a full prompt. Poems, Stories, and Diary are distinct content types and must not be collapsed into a single generic editor. Update this table if a phase's mobile scope changes.

| Screen | Phase | Contents |
|---|---|---|
| Register | 1 | username, display name, email, password fields; field-level validation errors; submit loading state |
| Login | 1 | email/username, password; forgot-password link; field-level validation errors |
| Profile (view/edit) | 1, 13 | avatar, display name, bio, follower/following counts, language setting, edit mode, follow/unfollow button, reading-streak badge |
| Story editor | 2B | story metadata, cover, synopsis, tags, ordered chapter list, chapter editor, autosave state, word count, preview, publish controls, draft recovery, validation |
| Story chapter reader | 2B | story cover/title context, chapter title, long-form typography, reading progress, previous/next chapter navigation, comments/reactions/save/share, unavailable-story/chapter state |
| Story overview | 2B | cover, title, author, synopsis, chapter count, publication state, start/resume reading action, save/share |
| Poetry editor | 2 | line-break-aware text area, live word/line counter, autosave "saving…/saved" indicator, draft-recovery prompt, anonymous toggle (Phase 7) |
| Poem reading | 2 | title, body text, author name/avatar, reaction bar, save/share icons, "no longer available" empty state |
| Discovery (mood picker, tag browse, trending, random) | 5 | filter/tab selector, infinite-scroll poem card grid/list, skeleton loading, distinct "end of list" vs "nothing here" empty states |
| Following feed | 5 | infinite-scroll poem card list from followed authors, cursor pagination |
| Collections | 6 | list of user's collections, create-collection flow, add/remove-poem-to-collection action |
| Collab poem (relay) | 8 | turn-by-turn poem view, "whose turn" indicator |
| Collab poem (open/branching) | 8 | branch picker at fork points, path-history breadcrumb |
| Duel | 9 | two poems side by side, vote buttons, optimistic vote state |
| Weekly prompt | 9 | prompt text, submission entry point |
| Remix creation | 9 | original poem shown with clear attribution, new poem editor |
| DM inbox | 10 | conversation list, anonymous-DM indicator |
| Chat | 10 | message thread, per-message pending/sent/failed state, anonymous DM toggle |
| Notifications list | 11 | notification list, unread-count badge, mark-as-read on view |
| Push-permission explainer | 11 | pre-OS-prompt explainer modal before requesting push permission |
| Writer dashboard | 12 | reads/reactions/comments/saves/follower-growth stats, heavier-query loading state, new-writer empty state |
| Moderation: report flow | 14 | report button + reason picker on content |
| Moderation: review queue (optional) | 14 | list of open reports for moderators |

Shared components (built once, reused everywhere — design these first since every screen above depends on them): toast/snackbar, skeleton loader, empty-state view, retry-capable error view, top-level error-boundary screen.

---

## 13. Design System & Tokens

Design source-of-truth is `DESIGN.md`, generated via the Stitch MCP export (see conversation notes — the Stitch skill enriches a short per-screen instruction with this file's tokens plus React Native platform conventions before sending it to Stitch).

**Process:**
1. Before building any screen, run one Stitch session to establish the base tokens below (don't leave this until Phase 15 — early "unstyled" screens should still reference the real theme file, not hardcoded values, so the Phase 15 pass is a reskin, not a rewrite).
2. Lock the result into `DESIGN.md` at the project root.
3. Every subsequent Stitch screen generation reads from that file, not from re-deriving the palette each time.

**"Ink & Parchment" starting point** (adjust during the actual Stitch session — this is a direction, not a final spec):
- Background: warm off-white/parchment tone, not pure white
- Primary text/ink: near-black with a slight warm or blue-black tint, not pure `#000`
- Accent: one warm accent color for CTAs/highlights (e.g. a muted terracotta or gold), used sparingly
- Type: a serif or humanist serif for poem body text (readability for long-form reading), a clean sans for UI chrome (buttons, labels, nav)
- Spacing scale: a consistent 4px/8px-based scale, not ad hoc per-screen values
- Dark mode: not required for v1 unless stated elsewhere — confirm before Stitch generates dark variants

**Conversion note:** Stitch outputs HTML/CSS. The Phase 15 build step converts this to RN `StyleSheet` objects / a shared theme constants file (colors.js, typography.js, spacing.js) — screens import from the theme file, they don't inline Stitch's raw CSS.

---


## 14. MCP-Assisted Build & Quality Workflow

This section is mandatory for the AI coding agent. The connected MCP servers are part of the build workflow:

- **Stitch MCP** — visual design exploration, screen-by-screen UI reference, and design consistency checks.
- **Context7 MCP** — current official/framework/library documentation before implementing unfamiliar or version-sensitive APIs.
- **MongoDB MCP** — Atlas inspection, schema/index verification, safe development-data inspection, query validation, and `explain()`-driven performance checks.
- **Playwright MCP** — browser-based validation of supported web/admin surfaces and end-to-end interaction verification. Native Expo flows must also use the project's React Native/Expo test stack and device smoke tests where Playwright is not applicable.
- **GitHub MCP** — repository inspection, issues, branches, pull requests, and review workflow.

### 14.1 Mandatory agent loop

For every feature:

1. **Inspect before changing** — read the relevant plan section, inspect the repository, and reuse existing components/services/schemas/tests.
2. **Consult the right MCP** — use Context7 for uncertain APIs, Stitch for new screens, MongoDB for data/query verification, Playwright for supported E2E flows, and GitHub for repository/issue/PR work.
3. **Implement a vertical slice** — data model → API/service → client state/data layer → UI → loading/empty/error states → tests.
4. **Validate before moving on** — run relevant tests, browser/device validation, MongoDB query checks, and visual/design checks.
5. **Review the diff** — remove debug code, dead code, duplicate components, accidental secrets, and temporary data; verify authorization/privacy paths.
6. **Record the work** — keep substantial work traceable through focused Git commits and GitHub issues/PRs where appropriate.

### 14.2 MCP responsibility matrix

| Task | Primary MCP | Required validation |
|---|---|---|
| New screen / redesign | Stitch | Visual consistency + UI states + implementation review |
| React Native / Expo / library API | Context7 | Build/type/test verification |
| Express/MongoDB implementation | Context7 + MongoDB | Integration tests + query/index verification |
| New MongoDB schema/index | MongoDB | Index existence + constraints + query-plan verification |
| Feed/search/hot query | MongoDB | `explain()` + stable cursor pagination |
| Browser/admin flow | Playwright | End-to-end interaction + failure-state check |
| Cross-feature regression | Playwright + project tests | Critical paths remain green |
| Repository/issue/PR work | GitHub | Reviewable diff + no secrets |
| Visual regression investigation | Stitch + Playwright | Intended design vs implemented result |

### 14.3 Stitch workflow

Before implementing each major screen:

1. Read §12 and §13.
2. Check existing shared components and tokens.
3. Use Stitch MCP to establish/explore the screen design.
4. Record reusable design decisions in `DESIGN.md`.
5. Implement the design in React Native using the shared theme/components. Never paste Stitch HTML/CSS into the Expo app.
6. Re-check hierarchy, spacing, typography, states, and interaction behavior against the design.
7. Preserve the established design system instead of regenerating it independently for every screen.

Every screen must define, where applicable: content hierarchy, primary/secondary actions, loading, empty, error, retry, disabled, offline, success feedback, destructive confirmation, accessibility labels, long-content behavior, keyboard/safe-area behavior, and touch targets.

### 14.4 Context7 workflow

Use Context7 whenever dependency APIs, Expo/React Native behavior, Socket.io, BullMQ, Redis, Mongoose/MongoDB, Cloudinary, authentication, push notifications, or other version-sensitive behavior is uncertain.

Rules:
- Prefer current official documentation surfaced through Context7.
- Do not invent APIs, options, method names, or configuration fields.
- Match the installed dependency version.
- If docs and existing code disagree, inspect package versions and resolve the mismatch explicitly.

### 14.5 MongoDB MCP workflow

After every meaningful schema/index/query change:

1. Inspect the relevant Atlas collection/index state.
2. Confirm unique and compound indexes actually exist.
3. Test representative development data.
4. Run/inspect `explain()` for hot queries.
5. Confirm cursor pagination is stable and deterministic.
6. Confirm projections return only fields needed by the mobile screen.
7. Confirm visibility, moderation, and anonymity filters are applied before serialization.
8. Verify denormalized counters and idempotency where required.
9. Never use production data for ad-hoc testing.
10. Never expose database credentials or sensitive values in logs, screenshots, commits, issues, or PRs.

A feature is not database-complete merely because its Mongoose model compiles.

### 14.6 Playwright MCP quality loop

For every critical browser-testable journey:

- start from a known state;
- perform the real user flow;
- verify the visible result;
- test at least one validation/error path;
- verify important loading/disabled states;
- take screenshots when visual comparison is useful;
- repeat after fixes.

Critical flows include authentication, profile editing, publishing poems/stories, story chapter navigation, discovery/search, reactions/comments/saves, collections, collaboration, duel/prompt/remix, messaging, notifications, and moderation where browser-testable.

For native-only Expo flows that Playwright cannot exercise directly, use the project's React Native/Expo-compatible automated tests and real-device smoke tests instead. Do not claim native coverage from a browser test.

### 14.7 GitHub MCP workflow

Use GitHub MCP to keep work organized:

- inspect current branch/repository state before beginning;
- inspect existing issues/PRs before creating duplicates;
- create/update issues for substantial features or bugs when appropriate;
- keep feature branches focused;
- use descriptive commits;
- record test/validation notes on substantial PRs;
- review the final diff for secrets and generated junk;
- follow the repository's configured CI/review rules.

Suggested lifecycle:

`issue → branch → implement → tests → MCP validation → review diff → commit → PR → CI → review → merge`

GitHub MCP does not replace the project's actual build/test commands.

### 14.8 Definition of Done

A feature is complete only when applicable items are satisfied:

- [ ] Plan requirements implemented.
- [ ] Existing architecture inspected and reused.
- [ ] Data model and indexes are correct.
- [ ] Authorization/privacy enforced server-side.
- [ ] API validation and normalized errors implemented.
- [ ] Loading/empty/error/offline states implemented where relevant.
- [ ] UI follows `DESIGN.md` and Stitch-approved direction.
- [ ] Unit/component/integration tests cover important behavior.
- [ ] Browser E2E validation run where Playwright applies.
- [ ] Native/device validation run where browser testing does not apply.
- [ ] MongoDB query/index behavior verified for hot paths.
- [ ] No secrets, credentials, or debug data introduced.
- [ ] No unnecessary duplicate components/services created.
- [ ] Git diff is clean and focused.
- [ ] Documentation/issue/PR state updated when applicable.

### 14.9 Quality priority

When choosing between adding more screens and making the current feature reliable:

`Correctness → Security/Privacy → Data integrity → UX states → Accessibility → Performance → Visual polish → Additional features`

Never hide a functional error with visual polish. Never sacrifice privacy, authorization, or data integrity to make a flow appear complete.

## 15. Notes for the Building AI

- Anonymity is never true anonymity at the data layer — `authorId`/`userId`/`senderId` fields always store the real user reference. Anonymity is enforced only at the response-serialization layer, stripped unless the requester is the owner or has a moderator/admin role.
- Diary entries must never appear in any mood-based discovery query — enforce this at the query layer (diary and poems are separate collections, so this is naturally satisfied, but don't merge them into one collection later without preserving this exclusion).
- Poem edits are never destructive — every edit creates a new `PoemVersion`; `Poem.content`/`title` should be treated as a read-optimized cache of the current version, not the sole source of truth.
- Collaboration segment writes must check `parent.childCount` against the piece's configured max-branches before allowing a new child segment in multi-ending mode; single-ending mode allows exactly one child per segment.
- All secondary side effects (notifications, trending updates, analytics) go through BullMQ queues — never block the primary user-facing response on them.
- The Phase 15 design pass (§7, item 92) may only change styling, layout, and JSX/component structure for presentation. It must never alter data-fetching, state management, API calls, or business logic in any screen. If a screen appears to need a logic change during the design pass, stop and flag it rather than making the change inline.


---

## 16. Final Agent Handoff Rule

Treat this document as the product and engineering contract for Verso.

Before implementation, the agent must inspect the repository, inspect GitHub state when connected, verify installed package versions, read the relevant sections of this document, establish/verify `DESIGN.md` through the Stitch workflow, use Context7 for version-sensitive questions, use MongoDB MCP for Atlas schema/index/query verification, and use Playwright MCP for supported end-to-end validation.

Do not claim a feature is complete based only on generated code. A completed Verso feature must pass implementation, data, UI, test, and validation checks.
