# Autopilot caption learning loop (011)

**Date:** 2026-05-21  
**Scope:** Wire Deep Analysis `post_learning_patterns` into Auto-Queue / Autopilot AI captions. No schedule/scoring/image/pinterest changes.

## Purpose

Close the loop so the system is more hands-off: performance learnings from Deep Analysis influence **future Auto-Queue AI captions**, not only coaching UI and manual upload/carousel paths.

## Current learning gap

| Path | Uses `ai_learning` patterns? |
|------|----------------------------|
| Upload / carousel `generateAICaption` | Yes — `captions.js` → `ai-generate` with `learningPatterns` |
| Auto-Queue AI caption | **No** — called `ai-generate` with product/tone/platform only |
| Deep Analysis `storeLearnings` | Writes `post_learning_patterns` (`pattern_type: ai_learning`) |

## What Deep Analysis saves

`analyzePost` → `storeLearnings()` upserts rows:

- `pattern_type`: `ai_learning`
- `pattern_key`: truncated pattern text
- `pattern_value`: `{ pattern, evidence, apply_to_future, source_post_id, learned_at }`
- `confidence_score`, `sample_size`

## What Auto-Queue already uses (unchanged)

- `hashtag_performance` → `mergeHashtags`
- `posting_time_performance` → `getNextPostingTimes`
- `post_learning_patterns` → `category_performance`, timing priors
- Template fallback captions, scarcity guard, scoring metadata

## New caption-learning behavior

1. Once per Auto-Queue run, load up to **5** recent `ai_learning` / `ai_insight` patterns (deduped by advice text).
2. Load **category_insight** map for per-product context (same shape as `captions.js`).
3. Pass `learningPatterns: { ai_learnings, category_insights? }` into `ai-generate` caption requests.
4. `ai-generate` treats account learnings as **soft guidance** (not mandatory rules).
5. `selection_metadata` records:
   - `learning_guidance_used`
   - `learning_patterns_used_count`
   - `learning_pattern_ids` (when available)
   - `learning_guidance_source`: `"post_learning_patterns"`
6. Auto-Queue Preview / Post Detail show a one-line hint when guidance was used.

## Files changed

| File | Change |
|------|--------|
| `docs/pages/admin/social/implementation/011_autopilot_caption_learning_loop.md` | This doc |
| `supabase/functions/auto-queue/index.ts` | Load patterns, pass to AI, metadata |
| `supabase/functions/ai-generate/index.ts` | Softer prompt for account learnings |
| `js/admin/social/features/autoQueue/autoQueuePreview.js` | Preview hint |
| `js/admin/social/features/posts/postDetailRender.js` | Post detail hint |

**Not changed:** `postLearning.js`, `captions.js`, scoring, schedules, resurface fill logic, edge deploy.

## Risks

- Overfitting if learnings are repetitive — mitigated by cap (5), dedupe, soft prompt.
- AI may still ignore guidance — template fallback unchanged.
- Category insight + account learnings may lengthen prompts — capped.

## Verification checklist

- [ ] At least one `ai_learning` row in `post_learning_patterns`
- [ ] Auto-Queue Preview with AI captions → console shows learnings count
- [ ] `selection_metadata.learning_guidance_used` true when patterns exist
- [ ] Captions still generate when patterns table empty
- [ ] Deep Analysis still persists learnings
- [ ] Manual upload caption still works
- [ ] Deploy `auto-queue` + `ai-generate` after approval

## Future OpenClaw notes

OpenClaw could rank/prune learnings, detect contradictions, and tune how often guidance is applied — out of scope for 011.
