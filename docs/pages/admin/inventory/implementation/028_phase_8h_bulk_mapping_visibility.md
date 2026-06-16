# Phase 8H — Bulk Mapping Visibility for Repeated eBay Patterns (Complete)

**Status:** Complete  
**Date:** 2026-06-09  
**Prerequisite:** Phase 8G (eBay safe mapping hints)  
**Next:** Phase 9 — Line Items Orders deep-links or post-map reservation/finalize batch assist (still confirmation-based)

---

## Summary

Added a **grouped eBay mapping worklist** with **selected-line apply only**. Repeated unmapped eBay patterns are visible at group level; admins review individual lines, select a subset, confirm product/variant, and apply mapping per line via the existing `apply_inventory_mapping_assist` RPC (wrapped in a batch RPC for audit). No auto-map, stock/reservation/ledger mutations, finalize, or channel API writes.

---

## Worklist / grouping logic

### Views

| View | Purpose |
|------|---------|
| `v_inventory_ebay_mapping_worklist_lines` | Line-level rows for eBay unmapped lines that belong to a **repeated** pattern (group size > 1) |
| `v_inventory_ebay_mapping_worklist` | Grouped summaries with counts, confidence aggregates, best suggestion, `recommended_action` |

### Group types

| `group_type` | Key source |
|--------------|------------|
| `source_sku` | `line_items_raw.product_id` / seller SKU |
| `product_code` | `products.code` join |
| `ebay_listing_id` | `products.ebay_listing_id` |
| `title` | `line_items_raw.product_name` |

A line may appear in multiple groups (e.g. same SKU also shares a title pattern). Line-level evidence is preserved in the lines view — groups are summaries only.

### `recommended_action` rules

| Action | When |
|--------|------|
| `review_and_apply_selected` | High-confidence lines, no manual variant pick required |
| `manual_variant_pick` | `variant_pick_required`, missing variant suggestion, or medium confidence present |
| `manual_search` | No suggestion on any line in group |
| `skip` | Reserved for future use (not emitted in current data) |

Medium confidence is **never** treated as safe to auto-apply.

---

## Database objects

| Object | Type | Notes |
|--------|------|-------|
| `inventory_mapping_assist_batches` | Table | Batch wrapper audit (counts, product/variant, per-line results JSON) |
| `v_inventory_ebay_mapping_worklist` | View | Group summaries |
| `v_inventory_ebay_mapping_worklist_lines` | View | Line-level review rows |
| `apply_inventory_mapping_assist_batch` | RPC | Admin-only; loops `apply_inventory_mapping_assist` per line; per-line audit in `inventory_mapping_assist_actions` |

Migration: `supabase/migrations/20260916_inventory_phase8h_bulk_mapping_visibility.sql`

---

## UI behavior

### Launch points

| Surface | Entry |
|---------|-------|
| Issues panel | **eBay Worklist** on `unmapped_order_line` issue group |
| Issue detail modal | **Open eBay Mapping Worklist** for `unmapped_order_line` |
| Shipped Finalize Audit modal | **Open eBay Mapping Worklist** |
| Mapping Assist modal | **Open eBay Mapping Worklist** (eBay channel only) |

### Worklist modal flow

1. **Groups list** — pattern label, row/qty/shipped counts, suggestion, confidence, reason, action badge, **Review Lines**
2. **Review Lines** — checkboxes per line, shipped/unshipped warnings, variant picker or product search
3. **Select suggested lines** — shown only for high-confidence exact groups (`review_and_apply_selected`); selects high-confidence lines with variant, not all lines by default
4. **Apply Mapping to Selected Lines** — disabled until ≥1 line selected + variant chosen; `window.confirm` required
5. **Post-apply** — opens Phase 9A post-map checklist with mapped/failed/skipped summary; refreshes issues/worklist (no auto retry/finalize)

---

## Apply rules

- Admin must review group, select specific lines, choose variant (required if `variant_pick_required`), and confirm
- No default select-all for medium or manual-pick groups
- Batch RPC applies one line at a time; failures reported per line; others continue
- Each successful line creates `inventory_mapping_assist_actions` row (via existing RPC)
- Batch row in `inventory_mapping_assist_batches` with aggregate counts

---

## Safety rules (unchanged / enforced)

| Excluded | Status |
|----------|--------|
| Automatic mapping without selection | ✅ Not implemented |
| Auto-finalize after mapping | ✅ Not implemented |
| Auto-reservation retry | ✅ Not implemented |
| Stock / reservation / ledger mutations | ✅ Not in batch path |
| eBay / Amazon API writes | ✅ Not in scope |
| Channel sync changes | ✅ Not in scope |

---

## Counts (linked DB — verification run)

### Before 8G context (unchanged underlying unmapped lines)

| Metric | Count |
|--------|------:|
| eBay `ebay_listing_id` suggestions | 16 |
| eBay `product_code_from_sku` | 10 |
| No suggestion | 8 |
| Manual variant pick required | 8 |
| Repeated pattern groups (8G view) | 19 |

### After 8H worklist views

| Metric | Count |
|--------|------:|
| Worklist groups | 25 |
| Worklist line rows (may duplicate across group types) | 67 |
| `review_and_apply_selected` | 22 |
| `manual_search` | 3 |
| `manual_variant_pick` | 0 (in current grouped data; line-level picks still apply) |

Top groups: title "Funny Heads or Tails…" (5), product code KK-0034 (5), source SKU KK-0034 (5).

---

## Verification

```bash
node scripts/verify-inventory-phase8h-bulk-mapping-visibility.mjs
```

**Result:** PASS

- Grouped worklist loads
- Repeated groups show counts; line review matches group `row_count`
- Confirmation gate present in UI source
- Batch RPC + batch audit table exist
- No stock/ledger/reservation change during read-only verify
- Inventory page loads with `#inventoryEbayWorklistModalMount`

---

## Files

| Created | |
|---------|--|
| `supabase/migrations/20260916_inventory_phase8h_bulk_mapping_visibility.sql` | Views, batch table, batch RPC |
| `js/admin/inventory/api/ebayMappingWorklistApi.js` | Fetch worklist/lines, batch apply |
| `js/admin/inventory/ui/ebayMappingWorklistModal.js` | Groups → review → select → confirm |
| `scripts/verify-inventory-phase8h-bulk-mapping-visibility.mjs` | Verification |

| Changed | |
|---------|--|
| `pages/admin/inventory.html` | Worklist modal mount |
| `js/admin/inventory/dom.js` | `ebayWorklistModalMount` |
| `js/admin/inventory/events.js` | Issues panel worklist handler |
| `js/admin/inventory/renderers/renderIssues.js` | eBay Worklist button |
| `js/admin/inventory/ui/issueDetailModal.js` | Worklist launch |
| `js/admin/inventory/ui/shippedFinalizeAuditModal.js` | Worklist launch |
| `js/admin/inventory/ui/mappingAssistModal.js` | Worklist launch (eBay only) |

---

## Limitations

- Same physical line may appear in multiple group types (SKU + title + listing)
- Worklist only includes patterns with **>1** unmapped line; singletons remain in single-line Mapping Assist
- No bulk apply across unrelated groups in one action
- Product search is same ilike pattern as Mapping Assist (8C)
- Verify script does not execute live batch apply (no test order lines mutated)
- Post-map reservation retry and shipped finalize remain separate manual workflows (8D / 8F)

---

## Recommended next phase

**Phase 9A:** Post-map workflow checklist — ✅ [029_phase_9a_post_map_workflow_assist.md](./029_phase_9a_post_map_workflow_assist.md). **Next:** post-map action queue (9B).
