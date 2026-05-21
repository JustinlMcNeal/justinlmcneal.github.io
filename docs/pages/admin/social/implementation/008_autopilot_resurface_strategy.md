# Autopilot resurface strategy (008)

**Date:** 2026-05-21  
**Scope:** Bounded, visible resurfacing when Autopilot fills the queue. No scoring formula changes, no Image Pool policy changes, no Pinterest routing changes, no OpenClaw, no merge of manual `auto-repost` into Autopilot.

## Purpose

Make **Resurface Winners** a deliberate **Autopilot content strategy** instead of hidden `auto-queue` behavior (`generatedPosts.length >= 4`, hardcoded 30 days, replace last slot only).

Users should see:

- What Autopilot will do (enabled, min age, max per run)
- What last Run Now did (new vs resurfaced counts)
- That manual controls remain for test/override

## Current hidden behavior (before 008)

| Behavior | Detail |
|----------|--------|
| Trigger | `generatedPosts.length >= 4` only |
| Age | Hardcoded 30 days |
| Quality | Above-median `engagement_rate` (needs ≥5 posted rows) |
| Action | Replace **last** generated slot |
| Control | No UI flag; runs on manual Generate too when batch ≥4 |
| Visibility | Not in `autopilot_last_run` or Automation Health |

## New Autopilot resurface strategy

When `autopilot-fill` calls `auto-queue` with `source: "autopilot"`:

1. Read resurface flags from request (sourced from `social_settings.autopilot`).
2. If **enabled** and `resurface_max_per_run > 0`:
   - Find proven winners (posted, older than `resurface_min_age_days`, above median engagement).
   - Replace up to **max** slots from the **end** of the in-memory batch (same scheduling slot, fresh caption).
   - Apply duplicate guards (product cooldown, no repeat of same source post / product in batch).
3. If **disabled** or not autopilot source: **no** auto-resurface.

**Defaults** (missing settings): enabled `true`, min age `30`, max per run `1`.

Manual **Preview / Generate** does not pass `source: "autopilot"` → no automatic resurface (preserves prior “manual runs don’t surprise with resurfaced slots” expectation).

## Settings added (`social_settings.autopilot`)

| Key | Type | Default |
|-----|------|---------|
| `resurface_in_autopilot` | boolean | `true` |
| `resurface_min_age_days` | number | `30` |
| `resurface_max_per_run` | number | `1` (capped 0–3 in UI/edge) |

Saved with **Autopilot → Save Settings** (reads controls in Resurface Winners section).

## Backend behavior

### `autopilot-fill`

- Passes `source: "autopilot"` and resurface fields (camelCase + snake_case) to `auto-queue`.
- Writes `resurfaced_count`, `new_product_count`, resurface flags/skips into `autopilot_last_run`.

### `auto-queue`

- Removes legacy `>= 4` hidden block.
- `applyAutopilotResurfaceStrategy()` runs only for autopilot source when enabled.
- Post `selection_metadata`: `selected_reason: "auto_resurface_hit"`, `resurface_method: "autopilot_strategy"`, `content_mix_type: "resurface"`, `resurface_source_post_id`, `resurface_min_age_days`, `resurface_rank_reason`.
- `run_summary`: `resurfaced_count`, `new_product_count`, `resurface_enabled`, `resurface_limit`, `resurface_skipped_reason`.

## UI behavior

### Resurface Winners section

- **Autopilot strategy** card: enable, min age, max per run; note to save via Autopilot Save Settings.
- **Manual test controls** card: unchanged `auto-repost` buttons.

### Run Now / Automation Health

- Alerts and last-run lines show mix, e.g. `3 new, 1 resurfaced` or `Resurface enabled, no eligible winners`.

## Manual Resurface Winners relationship

| Path | Role |
|------|------|
| Autopilot + `auto-queue` | Automatic, bounded, settings-driven |
| Manual Test / Repost Now + `auto-repost` | Preview or force repost; unchanged |

## Risks

- Small Autopilot runs may still get 0 resurfaced if no eligible winners (by design).
- Resurface still uses `resurface_exception` image path (existing); not a change to Image Pool-only policy for normal picks.
- Replacing last slot(s) may swap out a newly scored product — acceptable at max 1 default.

## Verification checklist

- [ ] Auto-Queue tab loads; Autopilot resurface controls visible
- [ ] Save Autopilot Settings persists resurface keys in `social_settings.autopilot`
- [ ] Run Now with resurface on: summary shows new vs resurfaced; ≤ max resurfaced
- [ ] Run Now with resurface off: `resurfaced_count` 0, summary says disabled
- [ ] Manual Generate/Preview: no unexpected resurfaced posts
- [ ] Manual Test Resurface / Repost Now still work (`auto-repost`)
- [ ] `node --check` on touched JS modules
- [ ] Edge deploy `autopilot-fill` + `auto-queue` before production behavior changes

## Follow-up

- Unify autopilot posting times/tones with Optimization Defaults form
- Optional: prefer Image Pool asset on resurface when available (without weakening pool-only for new picks)
- OpenClaw tuning of min age / max per run from performance data
