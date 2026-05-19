# Admin Social — Phase 3a: Auto-Queue Settings & Preview Transparency

**Date:** 2026-05-19  
**Type:** Implementation (settings wiring + preview visibility)  
**Prerequisites:** `016_admin_social_phase3_autoqueue_autopilot_audit.md`, Phases 2a–2e  
**Scope:** Phase 3a-A (settings body + persistence) + 3a-B (preview/post detail metadata)

---

## 1. Problems fixed

| ID | Problem | Fix |
|----|---------|-----|
| P1 | UI sent `captionTones` / `postingTimes` but `auto-queue` only read `count`, `platforms`, `preview` | Edge function merges validated request body over `social_settings.auto_queue` per run |
| P2 | Operators changed form controls that did not affect generation | Preview/generate save form to DB; body + DB both drive runs |
| P3 | Confirm dialog used `settings.platform` (undefined) | Uses `formatPlatformsLabel(settings.platforms)` |
| P4 | `selection_metadata` written but invisible | Preview list + post detail modal show summary + collapsible JSON |
| P5 | Preview did not explain selection | Shows priority, score breakdown, image source, resurface, last posted, run settings banner |

---

## 2. Files changed

| File | Change |
|------|--------|
| `supabase/functions/auto-queue/index.ts` | `resolveAutoQueueRunSettings()`; body aliases; `settings_used` in preview response |
| `supabase/functions/autopilot-fill/index.ts` | Sends `captionTones` / `postingTimes` aliases to auto-queue |
| `js/admin/social/autoQueue.js` | Load/save `social_settings.auto_queue`; rich preview; save before preview/generate |
| `js/admin/social/postDetail.js` | `postDetailSelection` section for queue metadata |
| `pages/admin/social.html` | Save button + `postDetailSelection` container |

---

## 3. Request body override (auto-queue)

1. Load `social_settings.setting_key = 'auto_queue'` (defaults if missing).
2. Merge **validated** request fields when present:

| Body field (aliases) | Maps to |
|---------------------|---------|
| `count` | posts per run (1–20) |
| `platforms`, `platform` | instagram / facebook / pinterest |
| `captionTones`, `caption_tones`, `tones` | tone allow-list |
| `postingTimes`, `posting_times` | `HH:MM` ET slots |
| `preview` | boolean |

3. Invalid/malformed values are ignored; DB value or hardcoded default used.
4. Preview responses include `settings_used` echoing the merged run config.

**Autopilot-fill** unchanged math; request now includes tone/time aliases so auto-queue honors autopilot `tones` / `posting_times` when set.

---

## 4. Settings persistence (admin UI)

- **Load:** `loadAutoQueueSettings()` on auto-queue tab setup — restores count, platforms, posting times, caption tones from `social_settings.auto_queue`.
- **Save:** `saveAutoQueueSettings()` upserts merged JSON:

```json
{
  "count": 4,
  "platforms": ["instagram", "facebook"],
  "posting_times": ["09:00", "17:00"],
  "caption_tones": ["casual", "urgency"],
  "updated_at": "..."
}
```

- Unrelated keys on `auto_queue` and other `social_settings` rows are preserved (spread existing `setting_value` before write).
- **Save Auto-Queue Settings** button saves explicitly; preview/generate save silently first.

---

## 5. Preview / detail fields added

**Auto-queue preview (per item):**

- Product name, platform, scheduled time, tone badge
- Resurface badge when `selection_metadata.is_resurfaced`
- Summary line: priority score, score breakdown, image source, caption source, carousel count, last posted
- Collapsible **Selection metadata** JSON
- Banner: **Run settings** from `settings_used`

**Post detail modal (`#postDetailSelection`):**

- Resurfaced flag, priority score, image source, reason, score breakdown, caption source
- Collapsible full `selection_metadata` when present

---

## 6. Intentionally not changed

- Scoring weights in `auto-queue` product selection
- Autopilot volume (`days_ahead × posts_per_day`, deficit math)
- AI prompts / caption generation strategy
- Publish/posting edge functions and crons
- Public Socials page
- New platforms
- Auto-repost selection logic (still uses fixed repost tones)

---

## 7. Risks

| Risk | Mitigation |
|------|------------|
| Stale edge function in prod until deploy | Deploy `auto-queue` after merge; UI works against old edge until then |
| Body override bypasses saved DB for one run only | Expected; DB still updated on preview/generate from UI |
| Large `selection_metadata` in DOM | Collapsed `<details>`; only on preview/detail |
| Posts created before 3a lack metadata | Detail section hidden when empty |
| `priority_score` not a DB column on `social_posts` | Shown from preview response or `selection_metadata` when stored |

---

## 8. Manual verification checklist

- [ ] Open Admin → Social → Auto-Queue; confirm form loads saved platforms/times/tones
- [ ] Change tones/times → **Save Auto-Queue Settings** → reload page → values persist
- [ ] **Preview Posts** → banner shows run settings; each row shows priority/image/resurface if applicable
- [ ] Expand **Selection metadata** on a preview row → valid JSON
- [ ] **Generate & Schedule** confirm shows platform list (not `undefined`)
- [ ] Open a queued post created by auto-queue → **Queue selection** section visible when metadata exists
- [ ] Autopilot-fill logs: auto-queue receives tones/times (optional: trigger manual autopilot-fill in staging)
- [ ] Grep: no `settings.platform` in `autoQueue.js` confirm string

**Deploy (required for edge behavior):**

```bash
npx supabase functions deploy auto-queue --project-ref yxdzvzscufkvewecvagq
```

Optional if autopilot-fill body aliases changed:

```bash
npx supabase functions deploy autopilot-fill --project-ref yxdzvzscufkvewecvagq
```

---

## 9. Recommended next phase (3b+)

- Tune scoring weights with A/B guardrails (`016` P2 items)
- Surface `settings_used` mismatch warnings when body ≠ DB intentionally
- Autopilot UI: clarify that auto-queue settings vs autopilot settings interact
- Days-ahead field on auto-queue form if product wants UI parity with autopilot horizon
