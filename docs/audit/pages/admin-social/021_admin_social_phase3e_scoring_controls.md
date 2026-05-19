# Admin Social — Phase 3e: Scoring Weight Controls & Preview Comparison Toggle

**Date:** 2026-05-19  
**Type:** Implementation (admin UI for existing 3c config)  
**Prerequisites:** `019`, `020` (3c scoring, dry-run comparison)  
**Scope:** Expose `social_settings.auto_queue.scoring_weights` and optional preview comparison — **no** edge formula changes

---

## 1. Purpose

Operators can view and save product-priority scoring weights without editing JSON in Supabase, and can turn off legacy comparison on preview for faster runs.

---

## 2. Files changed

| File | Change |
|------|--------|
| `pages/admin/social.html` | Scoring weights inputs, penalties toggle, reset button, compare toggle |
| `js/admin/social/autoQueue.js` | Load/save/reset weights; conditional `compareScoring`; preview run banner |

**No edge function changes** — server already reads `scoring_weights` from DB via `resolveScoringWeights()`.

---

## 3. Controls added

| Control | ID | Range / type |
|---------|-----|----------------|
| Recency weight | `aqWeightRecency` | 0–50 (default 40) |
| Category weight | `aqWeightCategory` | 0–50 (default 25) |
| Image freshness weight | `aqWeightImageFreshness` | 0–50 (default 25) |
| Inventory health weight | `aqWeightInventoryHealth` | 0–50 (default 10) |
| Penalties enabled | `aqPenaltiesEnabled` | checkbox (default on) |
| Reset scoring defaults | `btnResetScoringDefaults` | form only until Save |
| Compare legacy scoring | `aqCompareScoring` | checkbox (default on, preview only) |

---

## 4. Default values

Matches `DEFAULT_SCORING_WEIGHTS` in `auto-queue` (3c-v1):

```json
{
  "recency": 40,
  "category": 25,
  "image_freshness": 25,
  "inventory_health": 10,
  "penalties_enabled": true
}
```

If no `scoring_weights` in DB, the form shows these defaults on load.

---

## 5. Save / load behavior

**Load** (`loadAutoQueueSettings`):

- Reads `social_settings.auto_queue`
- Applies `scoring_weights` when present; else defaults above
- Does not change other fields (`count`, `platforms`, `posting_times`, `caption_tones`, `allow_multi_platform_per_product`, etc.)

**Save** (`saveAutoQueueSettings`):

- Merges into existing `setting_value` object
- Writes `scoring_weights: getScoringWeightsFromForm()` (client-clamped 0–50)
- Called before preview/generate (silent) and on **Save Auto-Queue Settings** (toast)

**Reset**:

- Sets form to defaults only
- Toast/alert: *“Click Save to persist”*
- Does **not** auto-save to DB

---

## 6. Preview comparison toggle

| State | Preview request | Comparison UI |
|-------|-----------------|---------------|
| `aqCompareScoring` checked (default) | `{ preview: true, compareScoring: true }` | Indigo comparison table + per-post lines |
| Unchecked | `{ preview: true }` only | No comparison block |

**Generate** always `{ preview: false }` — never sends `compareScoring`.

---

## 7. Preview run banner

After preview, header shows compact run line:

- Product count, platforms, tones, times (ET)
- `scoring_version` (e.g. `3c-v1`)
- Weights used: `R/C/I/H`
- Penalties on/off
- Compare on/off

---

## 8. Intentionally not changed

- Scoring formulas in `auto-queue`
- Autopilot volume / `autopilot-fill`
- Publishing functions
- Comparison snapshot persistence
- Public social page
- Full page layout redesign

---

## 9. Risks

| Risk | Mitigation |
|------|------------|
| Operator expects Reset to save immediately | Copy explains Save required |
| Extreme weights (50 each) | Client + server clamp 0–50 |
| Preview saves weights silently before run | Same as other settings (existing pattern) |

---

## 10. Manual verification checklist

- [ ] Fresh load: scoring fields show 40/25/25/10, penalties on
- [ ] Change weights → Save → reload page → values persist
- [ ] Other auto_queue fields (platforms, tones) unchanged after save
- [ ] Reset → form defaults; reload without Save → old DB values still there
- [ ] Reset → Save → DB has defaults
- [ ] Preview with compare on → network body includes `compareScoring: true`, comparison table visible
- [ ] Preview with compare off → no `compareScoring`, no comparison table
- [ ] Generate → body has `preview: false` only; no comparison
- [ ] Preview banner shows version, weights, penalties, compare state

**Deploy:** Not required for this phase (UI + JS only).

---

## 11. Recommended next phase (3f)

- Persist last comparison summary to `social_settings` (optional audit trail)
- Engagement quartile mini-widget when SQL returns enough rows
- Link from scoring section to `020` runbook / SQL query doc
