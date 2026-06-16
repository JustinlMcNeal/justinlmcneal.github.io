# Phase 8C — Mapping Assist Wizards (Complete)

**Status:** Complete  
**Date:** 2026-06-09  
**Prerequisite:** Phase 8B (issue resolution tracking)  
**Next:** Phase 8D complete — [024_phase_8d_reservation_retry_mapped_lines.md](./024_phase_8d_reservation_retry_mapped_lines.md). Phase 8E — bulk assist / eBay hints.

---

## Summary

Added **confirmation-based mapping assist wizards** for high-value inventory issues:

1. **Unmapped order lines** → set `line_items_raw.variant_id` (with snapshots)
2. **Amazon variant mapping gaps** → create/update `amazon_listing_mappings`

No auto-apply, no stock/reservation mutations, no Amazon/eBay API writes.

---

## Mapping audit findings

### Order lines

| Asset | Finding |
|-------|---------|
| `line_items_raw` | Shared table for KK / eBay / Amazon; **`variant_id` column exists** |
| `v_inventory_unmapped_order_lines` | Read-only gaps; reasons include `missing_variant_id`, `unknown_mapping`, `fuzzy_match_only`, `afn_skip` |
| Channel detection | Session id prefix (`stripe_*`, `ebay_*`, `amazon_*`) |
| Safe apply target | **Direct `variant_id` update** on specific line (admin RPC) |
| Excluded | AFN lines (`afn_skip`); retroactive reserve/deduct; eBay fuzzy auto-variant |

### Amazon

| Asset | Finding |
|-------|---------|
| `amazon_listing_mappings` | Listing → product + optional **variant** (`kk_variant_id`) |
| `amazon_mapping_missing` issue | Product has mapped listings; variant lacks variant-level row |
| Safe apply target | **Local `amazon_listing_mappings` insert** (mirrors amazon-map-listing semantics) |
| Excluded | SP-API quantity/listing push from assist wizard |

---

## Suggestion logic — `v_inventory_mapping_suggestions`

| Match type | Confidence | Unmapped lines | Amazon gaps |
|------------|------------|----------------|-------------|
| `exact_sku` | high | Variant SKU = line SKU | Variant SKU = seller SKU |
| `product_code` | high/medium | Product code match; single vs multi-variant | — |
| `seller_sku` | high/medium | Amazon listing SKU path | Product-level listing candidate |
| `manual_required` | low | No confident match | No listing candidate |

`is_safe_auto_apply` flags high-confidence matches but **UI always requires confirm**.

---

## Wizard UI

**Launch points:**

- Issue detail modal → **Open Mapping Assist** / per-sample **Map this row**
- Issues panel → **Map Assist** (first sample)
- Existing 8A primary routes unchanged (Orders / Amazon admin)

**Modal shows:** source SKU/title/ASIN, suggestion + confidence, product search, variant picker, impact copy, **Confirm Mapping** (with `window.confirm`).

---

## Apply actions — `apply_inventory_mapping_assist` RPC

| Action | Writes | Does not |
|--------|--------|----------|
| `order_line_variant` | `line_items_raw.variant_id`, snapshots | Stock, reservations |
| `amazon_variant_mapping` | `amazon_listing_mappings` | Amazon API |

**Audit:** `inventory_mapping_assist_actions` (before/after JSON snapshots).

**Post-apply:** refresh issues; mark group issue **reviewed** via existing `issueStateApi`.

---

## Mappings intentionally excluded

- eBay mapping wizard (product-level / unsupported variations)
- `missing_sku` auto-fix (needs product setup, not variant pick)
- Automatic suggestion apply
- Historical reservation backfill
- Channel sync scheduling

---

## Files

| Created | |
|---------|--|
| `supabase/migrations/20260911_inventory_phase8c_mapping_assist.sql` | Table, view, RPC |
| `js/admin/inventory/api/mappingAssistApi.js` | Suggestions + apply |
| `js/admin/inventory/ui/mappingAssistModal.js` | Wizard UI |
| `scripts/verify-inventory-phase8c-mapping-assist.mjs` | Verification |

| Changed | |
|---------|--|
| `issuesApi.js` | Assist-eligible samples |
| `issueDetailModal.js` | Assist entry points |
| `renderIssues.js` | Map Assist button |
| `events.js` | Panel assist handler |
| `dom.js`, `inventory.html` | Modal mount |

---

## Verification

```bash
node scripts/verify-inventory-phase8c-mapping-assist.mjs
```

**Result:** PASS

---

## Limitations

- One row per assist session in single-line wizard (bulk via Phase 8H worklist)
- Amazon assist requires listing id from suggestions view
- Product search uses simple name/code ilike (same pattern as Amazon admin)
- Custom snooze/date prompts unchanged from 8B

---

## Phase 8H extension

Bulk grouped visibility + selected-line apply — ✅ [028_phase_8h_bulk_mapping_visibility.md](./028_phase_8h_bulk_mapping_visibility.md).

| Surface | Entry |
|---------|-------|
| Issues panel / detail | eBay Mapping Worklist |
| Shipped Finalize Audit | Open eBay Mapping Worklist |
| Mapping Assist (eBay) | Open eBay Mapping Worklist |

---

## Recommended next phase

**Phase 8G extension:** eBay-specific match types and evidence — ✅ [027_phase_8g_ebay_safe_mapping_hints.md](./027_phase_8g_ebay_safe_mapping_hints.md).

**Phase 9:** Post-map workflow assist (finalize audit / reservation retry navigation) or Line Items Orders deep-links.
