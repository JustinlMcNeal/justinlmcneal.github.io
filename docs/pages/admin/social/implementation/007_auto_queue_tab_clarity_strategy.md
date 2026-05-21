# Auto-Queue tab clarity and strategy (007)

**Date:** 2026-05-21  
**Scope:** Admin Social Auto-Queue tab layout, copy, and settings ownership clarity. No scoring formula changes, no image pool policy changes, no Pinterest routing changes, no OpenClaw implementation.

## Purpose

Align the Auto-Queue tab with the page mission: **automated social posting optimized by data, AI learning, and future OpenClaw tuning** — while keeping manual controls available for preview, one-off fills, and testing.

Users should immediately understand:

- **Autopilot** = automatic schedule filling.
- **Manual Queue Builder** = same engine, user-triggered only.
- **Optimization Defaults** = shared tuning stored in `social_settings.auto_queue` (not “mystery manual settings”).
- **Eligibility Snapshot** = catalog readiness, not duplicate health.
- **Resurface Winners** = content strategy (with manual test buttons until full autopilot policy UI exists).

## Current confusion

| Issue | Why it hurts |
|-------|----------------|
| Manual Queue Generation banner sits above Auto-Queue Settings | Implies settings are only for manual runs |
| Settings card mixes batch size, platforms, times, tones, scoring | Unclear what autopilot vs manual controls |
| Product Posting Status | Sounds like queue state; overlaps mentally with Automation Health |
| Resurface Old Hits | Feels disconnected from autopilot; looks manual-only forever |
| Two tone/time sources | `autopilot` settings vs `auto_queue` settings (documented, not unified in this phase) |

## New section model

1. **Autopilot Control Center** — Autopilot Mode card + Automation Health card under one heading.
2. **Manual Queue Builder** — Batch size, platforms, compare-scoring toggle, Preview / Generate, preview panel.
3. **Optimization Defaults** — Posting times, caption styles, scoring weights, penalties, save (stored `auto_queue`).
4. **Eligibility Snapshot** — Product/catalog readiness metrics + pool-ready assets.
5. **Resurface Winners (Autopilot Content Strategy)** — Intent copy + manual test controls; note built-in auto-resurface in engine.

## Before / after layout

**Before (top → bottom):** Autopilot card → Health → Green manual banner → Settings (everything) → Preview/Generate → Preview results → Product stats → Resurface.

**After:**  
**Autopilot Control Center** (heading + autopilot + health) →  
**Manual Queue Builder** (heading + copy + count/platforms + preview/generate + preview) →  
**Optimization Defaults** (heading + times/tones/scoring/save) →  
**Eligibility Snapshot** →  
**Resurface Winners**.

## Settings ownership (audited)

| Setting key | Stored in | Used by |
|-------------|-----------|---------|
| Schedule volume, autopilot platforms | `social_settings.autopilot` | `autopilot-fill`, Autopilot UI |
| Autopilot tones/times (on save) | `social_settings.autopilot` (hardcoded on save in UI today) | `autopilot-fill` → passed into `auto-queue` body |
| Batch count, manual platforms, posting times, caption tones, scoring weights | `social_settings.auto_queue` | Manual Preview/Generate via `auto-queue`; scoring always read from DB in `auto-queue` edge |
| Autopilot enabled flag | `social_settings.autopilot` | Cron + Run Now |

**Manual Queue Builder** reads form fields for count/platforms; **Optimization Defaults** persist via Save → `auto_queue`.  
**Autopilot Run Now** does not read manual batch count from the form; it computes deficit and calls `auto-queue` with its own count. Tones/times for autopilot runs currently come from **autopilot** settings object on save (see `autopilot.js`), not from the Optimization Defaults form — noted as follow-up to unify.

## Resurface / autopilot integration audit

### Built into `auto-queue` (already)

When `generatedPosts.length >= 4` after normal product picks, the edge function may **replace the last slot** with one **auto-resurface** hit (posted 30+ days ago, above-median engagement). This runs on **every** non-preview `auto-queue` invocation, including **autopilot-fill** when it requests ≥4 product slots.

- Not gated by a user-facing enable flag.
- Not the same code path as **Manual Resurface** (`auto-repost` edge function).

### Manual only today

`autoQueueRepost.js` → `auto-repost` edge function: preview/repost winners by min age and count. Separate from autopilot card settings.

### Stored settings

No `resurface_old_hits` in `social_settings` for autopilot-fill today. Min age for engine auto-resurface is **hardcoded 30 days** in `auto-queue`.

### Phase decision (007)

Deferred autopilot resurface flags to **008** (`008_autopilot_resurface_strategy.md`).

### Follow-up

- Unify autopilot tones/times with Optimization Defaults form
- OpenClaw tuning of resurface min age / max per run

## Files changed

| File | Change |
|------|--------|
| `docs/pages/admin/social/implementation/007_auto_queue_tab_clarity_strategy.md` | This doc |
| `pages/admin/social.html` | Section structure, headings, copy, split manual vs defaults |
| `js/admin/social/features/autoQueue/autoQueueStats.js` | Pool-ready metric, eligibility copy hook |
| `js/admin/social/features/autoQueue/autoQueueSettings.js` | Save button label constant / comments only if needed |

**Not changed:** scoring math, `auto-queue` edge logic, `autopilot-fill`, image pool policy, board routing, public Socials.

## Risks

- Large HTML move only — element IDs preserved for JS bindings.
- Users may expect Optimization Defaults posting times to drive autopilot immediately (today autopilot save uses separate tone/time defaults).

## Manual verification checklist

- [ ] Open Auto-Queue tab — five section headings visible in order
- [ ] Autopilot toggle, Run Now, Automation Health unchanged
- [ ] Manual: Preview and Generate & Schedule work
- [ ] Save Optimization Defaults persists times/tones/weights
- [ ] Reset scoring defaults + Save still works
- [ ] Eligibility Snapshot loads numbers (+ pool-ready if shown)
- [ ] Resurface: Preview and Repost Winner Now work
- [ ] No console errors on tab switch
