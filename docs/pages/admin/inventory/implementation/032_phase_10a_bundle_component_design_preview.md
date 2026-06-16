# Phase 10A — Bundle / Component Inventory Design + Read-Only Preview (Complete)

**Status:** Complete  
**Date:** 2026-06-09  
**Prerequisite:** Phase 9C (queue resolution assist)  
**Next:** Phase 10C — live virtual bundle deduction (separate cutover)

---

## Summary

Designed bundle/component inventory models, added a future-ready **`inventory_bundle_rules`** table, read-only preview views, and Inventory admin UI labeled **Preview Only**. No checkout, reservation, finalize, stock, ledger, or channel sync behavior changed.

---

## Current bundle audit (linked DB)

### Schema today

| Area | Finding |
|------|---------|
| Product tables | `products` + `product_variants` only — no BOM/relationship table before this phase |
| Bundle fields | None on products or variants |
| Stock SOT | Each variant has independent `product_variants.stock` |
| Reservations | Per `variant_id` on order lines — no component breakdown |
| Mock/docs examples | `Brass D Ring x3` / `KK-0044-GLD-3PK` in mock data only — **not present in linked production catalog** |

### Heuristic scan (`v_inventory_bundle_like_variants`)

Patterns: `\bxN\b`, `\d+ pack`, `\d+pk`, `-pk`, `\bbundle\b`, `\bkit\b` (word-boundary `kit` avoids false positives like “Kitty”).

**Linked DB at verify:** **0** bundle-like variants matched. Catalog currently has no obvious pack/x3/3PK SKUs configured; bundle-like SKUs would still behave as **Model A separate stocked** variants.

### Channel presence

Without matching SKUs, no bundle-specific KK/Amazon/eBay listing linkage was detected. Existing channel sync and checkout continue to use per-variant `available = on_hand − reserved`.

---

## Model A vs Model B

| | **Model A — Separate stocked bundle SKU** | **Model B — Virtual/component bundle** |
|---|-------------------------------------------|------------------------------------------|
| Stock | Bundle variant has its own physical stock | No independent bundle stock |
| Reserve/finalize | Bundle variant only | Component variants × BOM qty |
| Availability | `bundle on_hand − reserved` | `min(floor(component_avail / qty))` |
| Risk | Lower — same as today | Higher — multi-variant coordination |
| Best for | Pre-packed items | Made-from-components kits |

**Recommendation:** Default all existing and detected bundle-like SKUs to **Model A** unless admin configures active rules in `inventory_bundle_rules` (`rule_type = virtual_bundle`). Preview views classify accordingly:

- `model_a_separate_stocked` — no active virtual rules
- `model_b_virtual_preview` — active virtual rules (preview math only)

---

## Schema added

### Table: `inventory_bundle_rules`

| Field | Notes |
|-------|-------|
| `bundle_variant_id`, `component_variant_id` | FK → `product_variants` |
| `component_qty` | Must be > 0 |
| `rule_type` | `virtual_bundle` (default) or `separate_stocked` |
| `is_active`, `notes`, audit columns | Config only |

**Constraints:** no self-reference; unique `(bundle_variant_id, component_variant_id)`  
**RLS:** admin authenticated read/write; service_role full access  
**Not consumed** by checkout, reservations, finalize, ledger, or sync in 10A.

### RPC: `upsert_inventory_bundle_rule`

Admin-only configuration save. **No inventory side effects.**

---

## Preview views

| View | Purpose |
|------|---------|
| `v_inventory_bundle_like_variants` | Heuristic audit of pack/bundle/kit patterns |
| `v_inventory_bundle_availability_preview` | Per-rule component availability + `max_bundle_available_from_component` |
| `v_inventory_bundle_summary_preview` | Per-bundle Model A/B classification + virtual avail + limiting component |

### `preview_status` (availability view)

`ready` · `component_shortage` · `inactive_rule` · `missing_component` · `self_reference_error`

(`no_rules` implied at summary level when no rules configured.)

---

## UI behavior

### Bundle / Component Preview panel (right column)

- **Preview Only** banner + checkout/sync disclaimer
- Counts: bundle-like SKUs, virtual rules, preview shortages
- Top summaries + detected patterns
- **Open Bundle Preview** button

### Bundle Preview modal

- Full summary + component breakdown
- Detected bundle-like SKU list
- **Add virtual bundle rule** form (config only — UUID + qty)
- Labels: *Does not affect checkout, stock, reservations, or channel sync yet.*

### Preview issues (Issues panel, low severity)

| Type | When |
|------|------|
| `bundle_component_shortage` | Virtual preview avail ≤ 0 |
| `bundle_rule_missing` | Bundle-like pattern, no virtual rules (Model A default) |
| `bundle_self_reference` | Invalid self-referencing rule |

**Not** added to header alert pills — preview only, does not block checkout or sync.

Primary action: **Open Bundle Preview**.

---

## What is explicitly NOT live

- Bundle/component deduction on order reserve or finalize
- Automatic component reservation
- Storefront `available` changes from virtual BOM
- Amazon/eBay bundle sync changes
- Parcel/CPI/manual adjustment changes
- Returns/restock component logic

---

## Risks

| Risk | Mitigation |
|------|------------|
| Heuristic false negatives | Admin can configure rules manually by variant UUID |
| Heuristic false positives | Word-boundary patterns; Model A remains default |
| Operators confuse preview with live stock | Persistent Preview Only labels + issue descriptions |
| Phase 10B cutover on mixed catalog | Require explicit `is_active` virtual rules + cutover flag (future) |
| Multi-component bundles | Preview uses MIN floor — document before live enable |

---

## Verification

```bash
node scripts/verify-inventory-phase10a-bundle-preview.mjs
```

**Result:** PASS

- `inventory_bundle_rules` + 3 preview views exist
- Config RPC exists; rejects unauthenticated direct pg calls (same pattern as 9C)
- On-hand / ledger / reservations unchanged after preview queries
- No deduction hooks in bundle UI source
- Inventory page + bundle panel/modal mounts load
- File line counts within limits (migration grandfathered at 563 lines)

**Preview counts (linked DB):** like **0**, summary **0**, rules **0**

---

## Files

| Created | |
|---------|--|
| `supabase/migrations/20260920_inventory_phase10a_bundle_preview.sql` | Table, views, RPC, preview issues |
| `js/admin/inventory/api/bundlePreviewApi.js` | Fetch preview + config upsert |
| `js/admin/inventory/ui/bundlePreviewModal.js` | Preview modal + rule form |
| `scripts/verify-inventory-phase10a-bundle-preview.mjs` | Verification |

| Changed | |
|---------|--|
| `js/admin/inventory/renderers/renderBundle.js` | Live preview panel |
| `js/admin/inventory/index.js` | Load/refresh bundle preview |
| `js/admin/inventory/dom.js` | Modal mount |
| `pages/admin/inventory.html` | Panel title + modal mount |
| `js/admin/inventory/services/issueActions.js` | Preview issue routes |
| `js/admin/inventory/services/issueActionHandlers.js` | `open_bundle_preview` |
| `js/admin/inventory/api/issuesApi.js` | Preview issue samples |
| `js/admin/inventory/api/inventoryApi.js` | Issue labels |

---

## Limitations

- Linked catalog has zero heuristic bundle-like matches today
- Preview capped at 50–100 rows in UI fetches
- Rule configuration uses product/variant picker (Phase 10B)
- Virtual availability ignores in-transit parcel stock
- `bundle_rule_missing` issue only fires when heuristics match — silent for unlabeled packs

---

## Recommended Phase 10C

Phase 10B added picker + rule management. **Next:** live Model B cutover — see [033_phase_10b_bundle_rule_management.md](./033_phase_10b_bundle_rule_management.md).
