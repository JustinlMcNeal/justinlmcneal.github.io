# Parcel Imports — Phase 7: Product/Variant Mapping + Mapping Memory

**Status:** Implemented and verified  
**Date:** 2026-06-08  
**Prerequisites:** Phase 6B complete ([010_phase_6b_save_draft_history.md](./010_phase_6b_save_draft_history.md))

**Goal:** Replace placeholder mapping with real product/variant selection, persist `product_id` / `product_variant_id` through Save Draft, and add DB-backed mapping memory suggestions.

---

## 1. Files changed

| File | Lines | Purpose |
|------|------:|---------|
| `js/admin/parcelImports/api/productsApi.js` | 87 | `searchProducts`, `loadProductVariants`, `getProductWithVariants` |
| `js/admin/parcelImports/api/mappingMemoryApi.js` | 137 | Suggestions lookup + save on draft |
| `js/admin/parcelImports/ui/productVariantPicker.js` | 250 | Per-row product search + variant select |
| `js/admin/parcelImports/ui/mappingMemory.js` | 139 | Suggestions UI + Apply |
| `js/admin/parcelImports/mapping/enumCodec.js` | 47 | Split from mappers |
| `js/admin/parcelImports/api/parcelImportsRehydrate.js` | 114 | Split DB decode helpers |
| `js/admin/parcelImports/api/parcelImportsMappers.js` | 211 | Payload only (was ~406) |
| `js/admin/parcelImports/mapping/mappingState.js` | 209 | `productId` / `productVariantId` + status rules |
| `js/admin/parcelImports/ui/itemMappingTable.js` | 167 | Real picker cells |
| `js/admin/parcelImports/api/parcelImportsApi.js` | 149 | Mapping fetch includes product IDs |
| `js/admin/parcelImports/api/parcelImportsLoader.js` | 69 | Uses rehydrate module |
| `js/admin/parcelImports/state.js` | 304 | `updateRowProductMapping`, suggestions state |
| `js/admin/parcelImports/ui/saveDraft.js` | 161 | Saves mapping memory after draft |
| `js/admin/parcelImports/index.js` | 92 | Init mapping memory |
| `js/admin/parcelImports/events.js` | 125 | Refresh suggestions after parse |
| `js/admin/parcelImports/ui/historyTable.js` | 203 | Hydrate pickers on Open Draft |
| `pages/admin/parcelImports.html` | — | `#parcelMatchSuggestionsList` hook |
| `scripts/verify-parcel-phase7-mapping.mjs` | — | Phase 7 automated test |

**Unchanged scope:** No approval, no `products.unit_cost` / variant cost / stock writes, no expenses, no inventory.

---

## 2. What works

### Product / variant search
- `searchProducts(query)` — `products` by `name` / `code` ilike, limit 20, active only
- `loadProductVariants(productId)` — ordered variants from `product_variants`
- `getProductWithVariants(productId)` — product + variants bundle

### Mapping UI
- Per-row product search input + result dropdown
- Variant dropdown loads after product selection
- Stores `productId`, `productVariantId`, labels, `mappingSource`
- Status: **Matched** when both IDs set; **Variant Uncertain** when product only
- Chips / KPI / CPI preview refresh on change

### Save / load persistence
- `buildSaveDraftPayload` sends real `productId` / `productVariantId` (not forced null)
- Open Draft restores IDs + labels; picker inputs rehydrate

### Mapping memory
- `findMappingSuggestions({ sellerName, sourceItemName })` from `parcel_mapping_memory`
- `saveMappingMemoryFromMappedRows()` on Save Draft success (insert or usage increment)
- Suggestions panel with **Apply to row** action
- `normalizeSourceItemName()` for dedupe key

---

## 3. Testing results

| Script | Result |
|--------|--------|
| `verify-parcel-phase3.mjs` | PASS (label mapping via state for unauthenticated local steps) |
| `verify-parcel-phase4.mjs` | PASS |
| `verify-parcel-phase6a-smoke.mjs` | PASS |
| `verify-parcel-phase6b.mjs` | PASS |
| `verify-parcel-phase7-mapping.mjs` | PASS |

### Phase 7 automated flow (2026-06-08)

1. Admin session on `127.0.0.1`
2. Upload `sample_baestao_waybill_227461.xls`
3. Search `8-Ball` on row 1 → select **8-Ball Dice Charm Keychain**
4. Select variant **Color: Black**
5. Status → **Matched**
6. Save Draft → DB mapping has `product_id` + `product_variant_id`
7. Update Draft → still **11 items / 11 allocations**
8. Open Draft → IDs + picker UI restored
9. Mapping memory row created for product

**Example IDs from test DB:**
- Product: `a53c9740-63d6-4a18-a4b2-636dcfe36624` (KK_0066)
- Variant: `a76174c5-698c-402a-9d82-6f40c69c04bb` (Color: Black)

---

## 4. Safety grep

Searched `js/admin/parcelImports/**/*.js` for forbidden writes:

- `UPDATE public.products` — **none**
- `UPDATE public.product_variants` — **none**
- `INSERT INTO stock_ledger` — **none**
- `INSERT INTO expenses` — **none**
- `unit_cost` updates — **none** (SELECT only in `productsApi`)
- Approve RPC / inventory — **none**

Only parcel/mapping-memory **SELECT + INSERT/UPDATE** on `parcel_mapping_memory`.

---

## 5. Remaining issues

| Item | Detail |
|------|--------|
| Product search requires admin session | Expected — no anonymous catalog search |
| `matchSuggestions.js` | Legacy stub unused; superseded by `mappingMemory.js` |
| No `source_url_hash` memory matching yet | Deferred per spec |
| CPI `productsAffected` still status-based | Does not require unique product IDs yet |
| Autocomplete UX | Simple search dropdown — no rich combobox |

---

## 6. Next recommended step

**Phase 8 — Approve + Update CPI** (when requested):

1. Approve RPC + `allocation_run_type = 'final'` snapshots
2. Weighted-average `products.unit_cost` updates
3. Optional expense linkage
4. Do **not** start until explicitly requested
