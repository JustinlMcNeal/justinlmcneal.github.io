# 006 — Recommended Execution Prompt

**Date:** 2026-05-12  
**Purpose:** Next best implementation prompt after reviewing this audit.

---

## Recommended next prompt

Use this prompt for the next implementation pass.

```text
We are ready to implement Phase 1 from:

docs/audit/pages/ebayListings/005_phase_plan.md

Goal:
Add read-only eBay listing workspace metrics to the existing eBay Listings admin page, without changing any live eBay write behavior.

Important constraints:
- Do NOT deploy edge functions unless a new read-only database migration requires no deploy.
- Do NOT change eBay listing create/edit/publish/end behavior.
- Do NOT change twilio/SMS/reporting code.
- Do NOT add React, bundlers, or build tools.
- Keep the page vanilla JS + Tailwind-heavy.
- Prefer Supabase read views over client-side analytics joins.
- No inline JS in any new markup. If touching row action rendering, use delegated event listeners and data attributes.
- Preserve current Push/Edit/Bulk/Setup/Import workflows.

Primary task:
Create a read-only Supabase view for the eBay Listings page and surface its metrics in the current UI.

Files to inspect first:
- pages/admin/ebay-listings.html
- js/admin/ebayListings/index.js
- js/admin/ebayListings/utils.js
- js/admin/ebayListings/editor.js
- js/admin/ebayListings/images.js
- js/admin/ebayListings/volPricing.js
- css/pages/admin/ebay-listings.css
- supabase/functions/ebay-manage-listing/index.ts
- supabase/functions/ebay-sync-orders/index.ts
- supabase/functions/ebay-sync-finances/index.ts
- supabase/migrations/20260716_ebay_listing_management.sql
- supabase/migrations/20260510_ebay_finance_transactions.sql
- supabase/migrations/20260511_ebay_finance_v4_status.sql

Implementation target:

1. Add a new migration:
   supabase/migrations/YYYYMMDD_ebay_listing_workspace_view.sql

2. Create a read-only view named:
   public.v_ebay_listing_workspace

3. The view should start conservative and include only fields that can be safely derived from existing schema:
   - product_id
   - product_code
   - product_name
   - slug
   - is_active
   - kk_price_cents (derive from products.price)
   - weight_g
   - catalog_image_url
   - primary_image_url
   - ebay_sku
   - ebay_offer_id
   - ebay_listing_id
   - ebay_status
   - ebay_category_id
   - ebay_price_cents
   - ebay_item_group_key
   - ebay_volume_promo_id
   - ebay_store_category
   - active_variant_count
   - active_variant_stock_total
   - gallery_image_count
   - sold_qty_30d
   - sold_qty_90d
   - last_sold_at
   - avg_sold_price_cents_90d if safely derivable
   - ebay_profit_cents_90d if safely derivable from v_ebay_order_profit and line_items_raw
   - ebay_ad_fees_cents_90d if safely derivable
   - issue_flags jsonb
   - issue_count

4. If a sales/profit field cannot be safely derived because the codebase lacks a reliable product/listing/SKU join, do NOT fake it. Set it NULL and document the blocker in SQL comments and a small note in the UI or audit follow-up.

5. Grant SELECT on the view to authenticated and service_role. Do not expose secrets.

6. Update js/admin/ebayListings/index.js to load from v_ebay_listing_workspace if available.
   - Preserve all existing fields needed by Push/Edit workflows.
   - If the view query fails, fall back to the existing products query and show a non-blocking status message.

7. Update the table/card display to add compact read-only badges:
   - Sold 30d
   - Last sold
   - Profit 90d or 'Profit —' if unknown
   - Promo badge if ebay_volume_promo_id exists
   - Issue count badge if issue_count > 0

8. Add a status filter option or quick filter for:
   - Needs Work (issue_count > 0)
   - No Sales 30d (active eBay listing with sold_qty_30d = 0 or NULL)
   - Has Promo (ebay_volume_promo_id exists)

9. Keep visual style consistent with the existing Tailwind-heavy admin UI.

10. Do NOT add profit estimation yet. That is Phase 2.

Verification:
- Run a syntax/static sanity check where possible.
- Query the view with Supabase CLI and show a few rows without exposing secrets.
- Load the page and confirm existing actions still render.
- Confirm Push/Edit/End buttons still appear based on ebay_status.
- Confirm the new badges show placeholders instead of crashing when sales/profit data is NULL.
- Confirm no edge functions were changed or deployed.

Deliverables:
- Migration file
- Minimal JS/CSS/HTML changes needed for read-only metrics
- Short summary of what fields are real vs blocked/NULL
- Exact verification checklist
```

---

## Why this is the best next prompt

The page already has enough eBay write actions. The biggest missing business value is context: which listings sell, which listings make money, and which listings need work.

Phase 1 is intentionally read-only. It should not risk live eBay listings. It also creates the data foundation needed for later profit preview, listing score, price reference, promotion manager, and performance/conversion work.
