# Admin Social — Phase 3c: Auto-Queue Scoring Tuning & Transparency

**Date:** 2026-05-19  
**Type:** Implementation (scoring quality + operator visibility)  
**Prerequisites:** `016`, `017`, `018` (audit, settings, safety guards)  
**Scope:** Improve selection ranking and explain *why* a product was picked — **without** increasing volume

---

## 1. Problem addressed

Phase 3b added eligibility and duplicate guards, but priority ranking still used a flat +10 “reserved” slot and weak differentiation for inventory/image risk. Operators could not see *why* one product outranked another beyond a minimal breakdown.

---

## 2. Scoring before (Phase 3a–3b)

| Component | Max points | Notes |
|-----------|------------|--------|
| Recency | 40 | 30+ days since post = full |
| Category performance | 30 | Mid default (15) when no data |
| Fresh pool images | 20 | +5 per unused pool asset, cap 20 |
| Flat reserved | 10 | Always applied |

**Total ~100.** No inventory penalties. Category boost even with sparse samples (15 default).

---

## 3. Scoring after (Phase 3c, `3c-v1`)

| Component | Default max | Notes |
|-----------|-------------|--------|
| Recency | 40 | Unchanged formula, weight configurable |
| Category performance | 25 | **35% of weight** if sample &lt; 3; full only when `sample_size >= 3` |
| Image freshness | 25 | Pool unused assets; **+3 boost** if 3+ fresh pool images |
| Inventory health | 10 | Replaces flat reserved; scales by stock status |

**Penalties** (subtracted when `penalties_enabled`, default true):

| Penalty | Points | Trigger |
|---------|--------|---------|
| `zero_stock_non_mto` | 8 | Warning `zero_stock_no_mto_flag` |
| `low_stock` | 3 | Warning `low_stock` |
| `missing_stock_data` | 4 | No variant stock rows |
| `weak_image_pipeline` | 5 | No pool assets and no approved AI images |
| `no_image_pool` | up to 6 | Reduces image component |
| `image_reuse` | 3 | Post-level when `image_reuse_guard === reused_no_alternative` |

**Boosts** (documented in metadata, some add points):

| Boost | Effect |
|-------|--------|
| `never_posted` | +2 metadata |
| `strong_category_performance` | Up to +15% of category weight when sample ≥ 5 |
| `strong_fresh_pool` | +3 image points when 3+ unused pool assets |
| `in_stock` | Full inventory health component |

Products are **not** excluded by penalties unless already skipped by Phase 3b eligibility/queue rules.

---

## 4. Configurable weights

Optional in `social_settings.auto_queue.scoring_weights`:

```json
{
  "recency": 40,
  "category": 25,
  "image_freshness": 25,
  "inventory_health": 10,
  "penalties_enabled": true
}
```

- Each weight clamped **0–50**
- Missing object → defaults above (backward compatible)
- No migration required

---

## 5. Metadata fields added

`selection_metadata` now includes:

| Field | Purpose |
|-------|---------|
| `scoring_version` | `3c-v1` |
| `priority_score` | Final score after image-reuse penalty |
| `score_breakdown` | recency, category_perf, image_freshness, inventory_health, penalties, subtotal |
| `scoring_weights_used` | Weights for this run |
| `penalties_applied` | Numeric map |
| `boosts_applied` | Numeric map |
| `inventory_penalty` | Sum of inventory penalties |
| `image_reuse_penalty` | 0 or 3 |
| `category_sample_size` | Learning pattern sample size |
| `top_boost` / `top_penalty` | First label in each list |
| `final_reason_summary` | One-line operator summary |

Phase 3b fields (`eligibility_warnings`, `duplicate_guard_result`, etc.) unchanged.

---

## 6. Preview UI (`autoQueue.js`)

Compact line per post:

- **Score** (priority)
- **Why** (`final_reason_summary`)
- **↑ Top boost** / **↓ Top penalty**
- Breakdown: recency · cat · img · inv · penalties
- Category sample count when &gt; 0
- Phase 3b warning badges unchanged
- Full JSON still in collapsible **Selection metadata**

Run settings banner shows `scoring_version` when present.

---

## 7. Intentionally not changed

- Autopilot-fill target count / `days_ahead` / `posts_per_day`
- Phase 3b safety guards (pending queue skip, one platform default, scarcity guard)
- Scoring weights UI editor (JSON in `social_settings` only)
- Publishing functions, crons, public social page
- AI prompt bodies
- New platforms

---

## 8. Risks

| Risk | Mitigation |
|------|------------|
| Lower scores for zero-stock may rotate them down, not out | Still queueable; only ranking changes |
| Custom weights set too high | Clamped 0–50 per component |
| Category name must match `post_learning_patterns.pattern_key` | Same as before |
| Image reuse penalty applied after sort | Small rank edge case; metadata reflects final score |

---

## 9. Manual verification checklist

- [ ] Preview posts show **Score**, **Why**, **↑ boost**, **↓ penalty**, breakdown
- [ ] `selection_metadata.scoring_version` = `3c-v1` on new previews
- [ ] Zero-stock non-MTO ranks below similar in-stock products (same recency)
- [ ] Product with 3+ fresh pool images shows `strong_fresh_pool` boost
- [ ] Pending-queue product still in **Skipped** list (3b)
- [ ] Generate confirm / volume unchanged
- [ ] Optional: set `scoring_weights` in DB and confirm `scoring_weights_used` in metadata

**Deploy:**

```bash
npx supabase functions deploy auto-queue --project-ref yxdzvzscufkvewecvagq
```

---

## 10. Recommended next phase (3d)

- Admin UI for `scoring_weights` (sliders + reset defaults)
- A/B logging: compare engagement for high vs low `priority_score` quartiles
- Resurface slot scoring alignment with 3c penalties
