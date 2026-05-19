# Admin Social — Phase 3b: Auto-Queue Safety Guards

**Date:** 2026-05-19  
**Type:** Implementation (eligibility + duplicate guards + caption safety)  
**Prerequisites:** `016`, `017` (Phase 3a settings/preview)  
**Scope:** Reduce bad automatic queue decisions **before** scoring weight tuning

---

## 1. Problems fixed

| Risk (from 016) | Mitigation |
|-----------------|------------|
| Same product queued across platforms in one batch | Default **one platform per product per run** (`primary_only`); opt-in via `allow_multi_platform_per_product` in `social_settings.auto_queue` |
| Weak product eligibility | Pre-score eligibility checks + skip reasons |
| Product already in pending queue | Block if `social_posts.status` ∈ `queued`, `draft`, `processing` |
| Urgency copy without inventory proof | Scarcity phrase guard on AI + templates; `urgency` tone dropped when not `in_stock` |
| Stale image reuse | Prefer pool/AI/gallery images not used in last 14 days when alternatives exist |
| Operators blind to skips | Preview **Skipped** panel + metadata warnings |

---

## 2. Eligibility rules added

Applied **before** priority scoring (hard skip vs warn):

| Check | Action |
|-------|--------|
| `is_active === false` | **Skip** (`inactive`) |
| Missing `name` or `slug` | **Skip** |
| Missing `catalog_image_url` | **Skip** (`no_usable_image`) |
| `shipping_status === 'mto'` | **Allow** + warning `made_to_order` |
| Sum of active `product_variants.stock` ≤ 0 and not MTO | **Allow** + warning `zero_stock_no_mto_flag` (not auto-excluded) |
| Stock ≤ 3 | **Allow** + warning `low_stock` |
| No variant rows | **Allow** + warning `no_variant_stock_data` |

**Inventory fields used:** `products.shipping_status`, `product_variants.stock` (active variants only).

**Not used (no reliable column):** dedicated backorder flag beyond MTO — zero-stock non-MTO products get a warning only.

---

## 3. Duplicate / cooldown rules added

| Rule | Behavior |
|------|----------|
| `last_social_post_at` 3-day cooldown | **Unchanged** (existing) |
| Pending queue duplicate | **Skip** product if any post in `queued` / `draft` / `processing` with same `product_id` |
| Multi-platform same batch | **Default:** first platform in `platformList` only per product |
| Multi-platform opt-in | Set `social_settings.auto_queue.allow_multi_platform_per_product: true` |
| Image reuse (14 days) | Skip recently used URLs when picking pool/AI/gallery; fallback if no alternative (`image_reuse_guard`) |

---

## 4. Inventory / backorder decision

- **MTO** (`shipping_status === 'mto'`): treated as intentionally sellable; scarcity copy still blocked unless variant stock shows `in_stock`.
- **Zero stock, not MTO:** not excluded (store may sell backorder without a DB flag); warning `zero_stock_no_mto_flag` + scarcity guard.
- **Scarcity-safe copy:** only when `inventory_status === 'in_stock'` (total active variant stock > 3).

---

## 5. Caption safety guard

- Regex detects scarcity phrases (limited stock, last chance, selling out, low stock, etc.).
- When not scarcity-safe: remove `urgency` from tone pool; template picker uses `casual` instead of urgency templates; strip phrases from AI/final captions.
- Metadata: `scarcity_guard_applied: true` when text was altered.

**AI prompts unchanged** — post-processing guard only.

---

## 6. Files changed

| File | Change |
|------|--------|
| `supabase/functions/auto-queue/index.ts` | Eligibility, duplicate, image reuse, caption guards, metadata, preview `skipped_products` / `run_summary` |
| `js/admin/social/autoQueue.js` | Skipped preview panel, warning badges, generate confirm note |
| `js/admin/social/postDetail.js` | Show guard fields in queue selection section |

---

## 7. Preview / metadata fields added

**`selection_metadata`:** `eligibility_passed`, `eligibility_warnings`, `duplicate_guard_result`, `image_reuse_guard`, `inventory_status`, `backorder_status`, `selected_reason`, `scarcity_guard_applied`, `multi_platform_mode`

**Preview response:** `skipped_products[]`, `run_summary` (`skipped_count`, `pending_queue_blocked`, `multi_platform_per_product`, …)

**UI badges:** Scarcity guarded, Zero stock, Skipped products list

---

## 8. Intentionally not changed

- Scoring weights (40/30/20/10)
- Autopilot volume math (`days_ahead × posts_per_day`)
- AI prompt bodies in `ai-generate`
- Publishing / cron / public social page
- New platforms

---

## 9. Risks

| Risk | Note |
|------|------|
| One platform per run may surprise operators expecting IG+FB pairs | Document opt-in flag in `auto_queue` JSON |
| Zero-stock products still queueable | By design until backorder column exists |
| Image reuse guard uses `image_url` equality | May miss path-normalization edge cases |
| `processing` status depends on 2a migration applied | Same as rest of admin social |

---

## 10. Manual verification checklist

- [ ] Preview a batch: confirm **Skipped** section when products already queued
- [ ] Queue a product, preview again — same product appears in skipped list
- [ ] Product with `shipping_status: mto` — queues with `made_to_order` warning, no false stock block
- [ ] Zero-stock non-MTO — preview shows **Zero stock** badge, post still generated if eligible otherwise
- [ ] Urgency tone + out-of-stock — caption lacks “limited/selling out” phrases; `scarcity_guard_applied` in metadata
- [ ] Multi-platform selected in UI — preview note “One platform per product” unless DB flag true
- [ ] Open queued post detail — inventory/backorder/guard fields visible

**Deploy:**

```bash
npx supabase functions deploy auto-queue --project-ref yxdzvzscufkvewecvagq
```

---

## 11. Recommended next phase (3c)

- Scoring weight tuning with guardrail metrics from `selection_metadata`
- Optional admin toggle for `allow_multi_platform_per_product`
- Dedicated `allow_backorder` product column if business rules require hard blocks
