# Verso — DESIGN.md

Single source of truth for visual design tokens and UI conventions.
Authored from build plan §13 ("Ink & Parchment") during Phase 0 — **without** Stitch.
Every screen reads tokens from `mobile/src/theme/tokens.ts`; no hardcoded values in screens.

> **Phase 15 contract:** the Stitch session replaces the *values* below with the exported
> design system. Structure (token names, component contracts, state patterns) stays.
> Stitch outputs HTML/CSS — convert to RN `StyleSheet`/theme constants, never paste as markup.

---

## 1. Direction: "Ink & Parchment"

A warm, paper-like reading surface for poetry, with restrained ink typography and a
single warm accent. Quiet, literary, unhurried — not a glossy social feed.

- **Background:** warm off-white / parchment, never pure white
- **Ink:** near-black with a warm tint, never pure `#000`
- **Accent:** one muted terracotta, used sparingly (CTAs, highlights, active states)
- **Type:** serif for poem body text (long-form readability), sans for UI chrome
- **Spacing:** strict 4/8-based scale, no ad hoc per-screen values
- **Dark mode:** not in v1

---

## 2. Color tokens

| Token | Value | Role |
|---|---|---|
| `colors.background` | `#FAF7F2` | App canvas (parchment) |
| `colors.surface` | `#FFFFFF` | Cards, sheets, inputs |
| `colors.surfaceAlt` | `#F3EDE4` | Secondary panels, pressed rows |
| `colors.ink` | `#1C1B19` | Primary text |
| `colors.inkSecondary` | `#5A5651` | Subtitles, secondary copy |
| `colors.inkMuted` | `#8A857E` | Placeholders, captions, disabled |
| `colors.border` | `#E4DDD3` | Hairlines, input borders |
| `colors.accent` | `#B85C38` | Primary CTA, links, active tab |
| `colors.accentPressed` | `#9A4A2B` | Pressed state of accent |
| `colors.accentSoft` | `#F5E3DA` | Accent tint backgrounds |
| `colors.onAccent` | `#FFFFFF` | Text on accent surfaces |
| `colors.success` | `#3E7C4F` | Success toasts, positive deltas |
| `colors.error` | `#B3261E` | Errors, destructive confirm |
| `colors.warning` | `#B07C1E` | Offline / degraded warnings |
| `colors.skeleton` | `#E9E2D8` | Skeleton loading blocks |
| `colors.overlay` | `rgba(28,27,25,0.45)` | Modal/scrim backdrop |

Rules:
- Accent never fills large areas — it marks action and state only.
- Text pairs must meet WCAG AA (4.5:1 body, 3:1 large text); re-verify after any palette change.
- One error color everywhere: toasts, field errors, banners.

---

## 3. Spacing & shape

Scale (4/8-based — use only these):

| Token | Value | Token | Value |
|---|---|---|---|
| `spacing.xs` | 4 | `spacing.lg` | 16 |
| `spacing.sm` | 8 | `spacing.xl` | 24 |
| `spacing.md` | 12 | `spacing.xxl` | 32 |
| | | `spacing.xxxl` | 48 |

Radii: `radii.sm = 6` (inputs, chips) · `radii.md = 10` (buttons) · `radii.lg = 16` (cards, sheets) · `radii.pill = 999`

Layout: `layout.touchTargetMin = 44` (every tappable element) · `layout.maxContentWidth = 560`

---

## 4. Typography

| Style | Font | Size / line-height | Use |
|---|---|---|---|
| `typography.poemBody` | serif (Georgia / android `serif`) | 18 / 32 | Poem body, long-form reading |
| `typography.title` | serif | 28 / 36 | Screen titles, poem titles |
| `typography.body` | sans (System / sans-serif) | 16 / 24 | Default UI copy |
| `typography.label` | sans | 14 / 20 | Buttons, form labels |
| `typography.caption` | sans | 12 / 16 | Timestamps, meta, helper text |

- Poem content is **always** `poemBody`; chrome (nav, buttons, tabs, counts) is always sans.
- No more than two type sizes per screen region.
- Respect device font scaling; never truncate poem text.

---

## 5. Component & state conventions

Every data-bearing screen implements, where applicable:

1. **Loading** — `LoadingState` or skeleton blocks (`colors.skeleton`), never a bare spinner on full-screen loads.
2. **Empty** — `EmptyState` (title + one-line explanation of what will appear here).
3. **Error** — `ErrorState` (plain-language message + "Try again" retry).
4. **Offline/degraded** — non-blocking `colors.warning` banner; reads still allowed from cache.
5. **Success feedback** — toast via `src/lib/toast.ts` (success/error/info), auto-dismiss.
6. **Destructive confirm** — explicit confirm dialog; destructive button uses `colors.error`.
7. **Disabled** — reduced opacity + no pointer events; never color-only indication.

Interaction:
- Touch targets ≥ 44pt; primary actions reachable in the lower half of the screen.
- Pressed states: accent → `accentPressed`; rows → `surfaceAlt`.
- Optimistic updates must roll back with an error toast on failure.
- Accessibility: label icon-only buttons, announce async results, keep contrast AA.

---

## 6. Screen scaffold (Phase 15 applies the final skin)

- Canvas `background` → content in `spacing.lg` gutters → `surface` cards at `radii.lg`.
- Hierarchy: one serif title, sans for everything else, accent only on the single primary action per screen.
- Authored against `tokens.ts` only — when Phase 15 changes token *values*, every screen reskins without code edits.
