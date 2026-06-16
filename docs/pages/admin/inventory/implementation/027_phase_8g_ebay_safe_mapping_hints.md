# Phase 8G — eBay Safe Mapping Hints for Historical Shipped Lines (Complete)

**Status:** Complete  
**Date:** 2026-06-09  
**Prerequisite:** Phase 8F (manual finalize assist)  
**Next:** Phase 9 — Bulk mapping visibility or marketplace finalize batch assist (confirmation-based)

---

## Summary

Extended **eBay-safe mapping suggestions** for historical unmapped/shipped order lines. Suggestion and assist only — all mappings still require admin confirmation via Mapping Assist. Shipped Finalize Audit now links eBay `missing_variant` rows to Mapping Assist; no auto-map, stock change, or finalize.

---

## eBay field audit

| Field | Source | Notes |
|-------|--------|-------|
| eBay order id | `orders_raw.stripe_checkout_session_id` (`ebay_%`) | Session prefix |
| Line item id | `line_items_raw.stripe_line_item_id` | |
| Seller SKU / product code | `line_items_raw.product_id` | Joins `products.code` |
| Title | `line_items_raw.product_name` | |
| Quantity | `line_items_raw.quantity` | |
| Buyer variation | `line_items_raw.variant`, `variant_title`, `selected_options` | Used for suffix matching |
| eBay listing id | `products.ebay_listing_id` | Not on line row; via product code |
| eBay SKU | `products.ebay_sku`, `ebay_listing_inventory_cache.ebay_sku` | |
| Offer id | `products.ebay_offer_id` | |
| Listing status | `products.ebay_status`, cache `listing_status` | Evidence only |
| Cache qty | `ebay_listing_inventory_cache.available_qty` | Observational |
| Item group key | `products.ebay_item_group_key` | → `manual_required` |
| Raw listing id on line | `v_inventory_unmapped_order_lines.ebay_item_id` | Always NULL (not stored on import) |

---

## Suggestion confidence rules

| Match type | Confidence | Variant suggested? |
|------------|------------|-------------------|
| `ebay_exact_sku` | high | Yes (single match) |
| `ebay_listing_id` | high / medium | Yes if one variant; else product only |
| `ebay_offer_id` | high | Yes if one variant |
| `product_code_from_sku` | high / medium | Yes / manual pick |
| `variant_suffix_from_sku` | medium | Suggested with `variant_pick_required` |
| `ebay_item_group_key` | low | No — manual pick |
| `title_similarity` | low | No — manual pick |
| `manual_required` | low | No |

All rows: `is_safe_auto_apply` remains false for medium/low; high matches still require Confirm in UI.

---

## Views updated

- **`v_inventory_mapping_suggestions`** — eBay match types, evidence columns, `variant_pick_required`, group counts per line
- **`v_inventory_ebay_unmapped_group_counts`** — repeated SKU / title / listing id patterns (visibility only)

---

## UI behavior

| Surface | Change |
|---------|--------|
| Mapping Assist | eBay evidence panel, product-only suggestions for multi-variant, title-only warning |
| Shipped Finalize Audit | **Map Line →** on eBay `missing_variant` rows opens Mapping Assist |
| Post-map (shipped) | Refreshes audit; no reservation retry; no auto-finalize |
| Manual Finalize | Unchanged — separate confirm path after mapping |

---

## eBay suggestion counts (linked DB — verification run)

| Match type | Count |
|------------|------:|
| `ebay_listing_id` | 16 (10 high, 6 medium) |
| `product_code_from_sku` | 10 (8 high, 2 medium) |
| No suggestion (`null`) | 8 |
| `title_similarity` | 0 |
| Manual variant pick required | 8 |
| Repeated pattern groups | 19 |

---

## What remains manual

- All mapping apply (`Confirm Mapping` + `window.confirm`)
- Multi-variant and variation-group listings
- Title-only matches
- Manual finalize after mapping (Phase 8F)
- Bulk apply across repeated SKUs — ✅ Phase 8H (selected-line only; see [028](./028_phase_8h_bulk_mapping_visibility.md))

---

## Verification

```bash
node scripts/verify-inventory-phase8g-ebay-safe-mapping-hints.mjs
```

---

## Limitations

- eBay listing id not stored on order line — matched via product code → product
- Title similarity is coarse (prefix ILIKE on product name)
- Shipped fully-refunded lines may not appear in unmapped suggestions view
- Repeated-pattern groups — bulk visibility via Phase 8H worklist (selected apply only)

---

## Recommended next phase

**Phase 9 / 8H:** Bulk mapping visibility — ✅ [028_phase_8h_bulk_mapping_visibility.md](./028_phase_8h_bulk_mapping_visibility.md). **Next:** post-map workflow assist or Line Items Orders deep-links.
