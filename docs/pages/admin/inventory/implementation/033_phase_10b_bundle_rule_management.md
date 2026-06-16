# Phase 10B — Bundle Rule Management Polish + Product Picker (Complete)

**Status:** Complete  
**Date:** 2026-06-09  
**Prerequisite:** Phase 10A (bundle design + read-only preview)  
**Next:** Phase 10C — virtual bundle simulation + shadow mode.

---

## Summary

Replaced raw UUID entry with a **searchable product/variant picker**, added **rule management** (edit qty, disable, remove), enhanced **preview summaries** with stocked vs virtual warnings, and added **config audit** logging. Still **preview/config only** — no checkout, reservation, finalize, stock, ledger, or channel sync changes.

**Model A default unchanged:** bundle-like SKUs remain separate stocked until virtual rules are explicitly configured.

---

## UI behavior

### Bundle / Component Preview modal

- Header: **Preview / Config Only** — no live deduction yet
- **Configured bundles** cards with on-hand / reserved / available, virtual avail, status badges
- Per-rule actions: **Edit**, **Disable/Enable**, **Remove**
- **Detected bundle-like SKUs** with **Use as bundle** (prefills bundle picker)
- **Add / edit component rule** form with pickers (not UUID fields)

### Right-column panel

- Updated disclaimer: preview/config only
- **Open Bundle Preview** opens full management modal

### Issue detail modal

- Preview bundle issues show **Open in Bundle Preview →** on sample rows
- Focuses/highlights the relevant bundle card when opened from sample

---

## Picker behavior

Module: `bundleVariantPicker.js` + `searchInventoryVariants()` in `bundlePreviewApi.js`

| Feature | Behavior |
|---------|----------|
| Search | Title, internal SKU, variant label via `v_inventory_workspace` (min 2 chars) |
| Selection | Shows label, SKU, on-hand, available; clear button |
| Bundle vs component | Separate pickers on add/edit form |
| Prefill | Edit rule, **Use as bundle**, issue sample deep-link |

---

## Validation

### Client (`validateBundleRuleInput`)

| Check | Result |
|-------|--------|
| Missing bundle/component | Error — blocks save |
| qty ≤ 0 | Error |
| bundle === component | Error |
| Bundle on-hand > 0 | Warning — Model A stock remains until 10C |
| Inactive component | Warning |
| Component available ≤ 0 | Warning |

Warnings require confirm before save.

### Server (RPC)

- `upsert_inventory_bundle_rule` — self-reference, qty, admin auth
- `set_inventory_bundle_rule_active` — disable/enable
- `delete_inventory_bundle_rule` — remove rule

---

## Config audit

Table: `inventory_bundle_rule_actions`

| Field | Notes |
|-------|-------|
| `action_type` | create, update, disable, delete |
| `rule_id`, bundle/component variant ids | |
| `old_values`, `new_values` | jsonb snapshots |
| `created_by`, `created_at` | |

Logged from upsert/disable/delete RPCs when called via authenticated admin session.

---

## Preview improvements

Enhanced `v_inventory_bundle_summary_preview` (columns appended in 10B):

| Field | Purpose |
|-------|---------|
| `bundle_reserved`, `bundle_available` | Stocked Model A metrics |
| `preview_status` | ready, component_shortage, no_rules, etc. |
| `has_independent_stock_warning` | Virtual rules + on-hand > 0 |
| `virtual_vs_stocked_delta` | Preview virtual minus bundle available |

UI shows status badges, dual-stock warnings, and virtual vs stocked delta when they differ.

---

## What is explicitly NOT live

- Component deduction on reserve/finalize
- Checkout `available` from virtual BOM
- Channel sync from virtual rules
- Stock/ledger mutations from rule CRUD

---

## Verification

```bash
node scripts/verify-inventory-phase10b-bundle-rule-management.mjs
```

**Result:** PASS

- Picker + search API present
- Self-reference blocked (RPC + DB constraint)
- Invalid qty blocked
- Preview summary updates after rule insert/delete
- On-hand / ledger / reservations unchanged
- Inventory page + modal mounts load

**Linked DB at verify:** bundle-like **0**, rules **0** (ephemeral test rule cleaned up)

---

## Files

| Created | |
|---------|--|
| `supabase/migrations/20260921_inventory_phase10b_bundle_rule_management.sql` | Audit table, RPCs, summary view |
| `js/admin/inventory/ui/bundleVariantPicker.js` | Searchable picker |
| `js/admin/inventory/ui/bundleRuleForm.js` | Add/edit form |
| `js/admin/inventory/ui/bundlePreviewSummary.js` | Summary cards + badges |
| `scripts/verify-inventory-phase10b-bundle-rule-management.mjs` | Verification |

| Changed | |
|---------|--|
| `js/admin/inventory/api/bundlePreviewApi.js` | Search, validation, disable/delete |
| `js/admin/inventory/ui/bundlePreviewModal.js` | Rule management orchestration |
| `js/admin/inventory/renderers/renderBundle.js` | Copy update |
| `js/admin/inventory/ui/issueDetailModal.js` | Sample → bundle preview route |
| `js/admin/inventory/api/issuesApi.js` | `bundleVariantId` on samples |

---

## Limitations

- Picker searches workspace view only (active catalog subset)
- Audit rows require admin RPC calls (direct SQL inserts skip audit)
- No multi-component wizard — one component line per save
- Linked catalog still has zero heuristic bundle-like SKUs
- Disable/delete from UI requires admin Supabase session

---

## Recommended Phase 10C (complete)

See [034_phase_10c_virtual_bundle_shadow.md](./034_phase_10c_virtual_bundle_shadow.md).

## Recommended Phase 10D

1. Global or per-bundle **live cutover flag** for Model B
2. Wire virtual availability into `v_kk_variant_available_stock` / checkout
3. Component reservation + finalize deduction with ledger audit
4. Prevent double-count when `has_independent_stock_warning`
5. Channel sync policy for virtual vs separate-stocked bundles

Stop after Phase 10B.
