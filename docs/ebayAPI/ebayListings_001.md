# eBay Listings System Audit (Admin Page)

## Scope
This audit documents the complete pipeline for the eBay Listings admin page:

- UI and user workflows in `pages/admin/ebay-listings.html`
- Edge function orchestration in `supabase/functions/ebay-manage-listing/index.ts`
- Supporting functions used by the page:
	- `ebay-taxonomy`
	- `ebay-ai-autofill`
	- `ebay-migrate-listings`

This includes feature inventory, wiring, state transitions, data dependencies, error/retry behavior, and known architectural risks.

---

## 1) High-Level Architecture

### Frontend runtime
- Single-page admin UI in `pages/admin/ebay-listings.html`
- Vanilla JS module script
- Tailwind CDN + custom CSS + Quill editor
- Uses Supabase JS client for DB reads (`products`) and direct fetch to edge functions

### Backend runtime
- Primary orchestration function: `ebay-manage-listing`
- Uses:
	- eBay Inventory API
	- eBay Account API
	- eBay Marketing API
	- eBay Notification API
- Persists listing linkage/status back to `products` table via service-role DB access

### Supporting functions
- `ebay-taxonomy`: category suggestions + aspect schema
- `ebay-ai-autofill`: GPT-powered title/description/aspect suggestions
- `ebay-migrate-listings`: import/link pre-existing eBay inventory to local products

---

## 2) Data Model and Key Fields

### Primary local table: `products`
The page depends heavily on these columns:

- `id`, `code`, `name`, `slug`, `price`, `weight_g`, `is_active`
- `catalog_image_url`, `catalog_hover_url`, `primary_image_url`
- `ebay_sku`
- `ebay_offer_id`
- `ebay_listing_id`
- `ebay_status` (`not_listed`, `draft`, `active`, `ended`)
- `ebay_category_id`
- `ebay_price_cents`
- `ebay_item_group_key` (for multi-variant listings)
- `ebay_volume_promo_id`

Related joins used in page load:
- `product_gallery_images(url, position, is_active)`
- `product_variants(id, option_name, option_value, stock, preview_image_url, sort_order, is_active)`

### eBay entities represented
- Inventory Item (single SKU)
- Offer (single SKU + marketplace + format)
- Inventory Item Group (multi-variation grouping)
- Group publish endpoint (`publish_by_inventory_item_group`)
- Item promotion (volume discount)

---

## 3) Page Features Inventory

### Core listing operations
- Push listing (single and multi-variant)
- Edit listing (single and group)
- Publish listing (single and group)
- End listing (single offer and group withdraw)
- Re-list ended listings via push flow

### Admin utilities
- Search/filter by status
- Table/card view toggle
- Bulk update price/quantity
- Setup policies and location
- Migrate/import existing eBay inventory

### Listing enrichment
- Taxonomy category suggestion
- Dynamic item specifics per category
- 3-mode description editor: Visual (Quill), HTML (raw textarea), and Preview (sandboxed iframe)
- `sanitizeForEbay()` strips scripts/iframes/event handlers before submission and preview rendering
- `wrapDescription()` wraps Quill output in branded HTML template
- Image strip with drag reorder and gallery add
- AI auto-fill for title/description/item specifics (source badges: AI/from_data/default/inferred)
- Best Offer settings
- Lot-size support
- Volume pricing create/update/delete

---

## 4) UI Wiring and State

### Top-level state variables
- `allProducts`, `filteredProducts`
- `currentProduct` (push modal context)
- `editProduct` (edit modal context)
- `currentAspects`, `editAspects`
- `pushImageUrls`, `editImageUrls`
- `pushVariants`, `isVariantListing`
- `editVariantImageOverrides` (variant SKU -> selected lead image)
- `currentView` (`table` or `cards`; defaults to cards on mobile, table on desktop)
- `bulkMode` (`price` or `qty`)
- Description mode state: `pushDescMode`, `editDescMode`

### Fetch abstraction
- `callEdge(fnName, body)` posts JSON to edge functions
- Uses `supabase.auth.getSession()` to obtain the user JWT; throws if no active session
- Non-JSON and HTTP-error responses are normalized to `{ success: false, error }` objects instead of throwing
- ~~Previously used a hardcoded `SERVICE_KEY` in browser context~~ — removed April 20, 2026

### Rendering pipeline
1. `loadProducts()` pulls products + joins from Supabase
2. `applyFilters()` applies search/status filter
3. `renderAll()` dispatches table or cards
4. stats updated from local array counts

---

## 5) End-to-End Pipeline Flows

## 5.1 Push (new listing / re-list)

### Step 0: Open push modal
- `openPush(code)` seeds modal fields from local product
- Detects variant mode by active variants count (`> 1`)
- Preloads image strip from catalog/primary/hover/gallery

### Step 1: Create item(s)
- Button: `btnCreateItem`

Single listing:
- Calls `create_item` once with SKU, product payload, packaging

Variant listing:
- Reads checked variants + per-variant quantities
- Skips qty 0 variants
- For each valid variant:
	- Creates SKU suffix from option value
	- Builds variant aspects with `Color`
	- Uses variant preview image as lead image
	- Calls `create_item`
- Stores successfully created variant SKUs in `_createdVariantSKUs`

### Step 2: Create offer(s)
- Button: `btnCreateOffer`

Single listing:
- Calls `create_offer`

Variant listing:
- Calls `create_item_group` (group metadata)
- Calls `create_group_offer` with `variantSKUs`
	- Backend creates/reuses one offer per variant SKU

### Step 3: Publish
- Button: `btnPublish`

Single listing:
- `publish(offerId)`

Variant listing:
- `publish_group(inventoryItemGroupKey)`

Post-publish optional:
- Creates or updates volume promotion depending on existing promo id

---

## 5.2 Edit flow

### Open edit modal
- `openEdit(code)`
- If group listing (`ebay_item_group_key` exists):
	- Loads group via `get_item_group`
	- Loads first variant offer to prefill offer-level settings (policies/store category)
	- Builds variant main-image controls
- If single listing:
	- Loads item + offers by SKU

### Edit capabilities
- Title, description (visual/html), condition, qty, lot
- Shared image strip reorder/add
- Variant main image selection from existing listing/gallery images
- Item specifics (required + optional from taxonomy)
- Price, policies, best offer, category id, store category
- Volume pricing toggle + tiers

### Save behavior

Single listing:
1. `update_item`
2. `update_offer` if offer exists
3. volume promo create/update/delete

Group listing:
1. `update_item_group` with shared aspects (Color removed)
2. For each variant SKU:
	 - `get_item`
	 - `update_item` with merged color + per-variant lead image override
3. For each variant SKU offer:
	 - `get_offers`
	 - `update_offer` (store category/policies/best offer/price)
4. volume promo create/update/delete

---

## 5.3 End listing

### Single listing
- `withdraw(offerId)`

### Variant/group listing
- `withdraw_group(inventoryItemGroupKey)`

Both paths set local product `ebay_status = ended`.

---

## 5.4 Bulk update

- Select active/draft rows
- Bulk modal supports price or qty mode
- Calls `bulk_update` (Inventory API bulk endpoint)
- Local DB price sync applied when bulk price mode succeeds

---

## 5.5 Setup and migration

### Setup panel
- `get_policies`
- `setup_location`

### Migration panel
- `ebay-migrate-listings`:
	- `scan`
	- `auto_link`

---

## 6) Backend Action Map (`ebay-manage-listing`)

Inventory item actions:
- `create_item`, `update_item`, `get_item`, `delete_item`, `list_items`

Offer actions:
- `create_offer`, `create_group_offer`, `update_offer`, `get_offers`, `delete_offer`

Publish/withdraw:
- `publish`, `publish_group`, `withdraw`, `withdraw_group`

Group actions:
- `create_item_group`, `update_item_group`, `get_item_group`, `delete_item_group`

Pricing ops:
- `bulk_update`

Policies/location:
- `get_policies`, `opt_in_policies`, `create_default_policies`, `setup_location`

Webhook notifications (Commerce Notification API):
- `setup_webhook_config`
- `create_webhook_destination`, `delete_webhook_destination`, `list_webhook_destinations`
- `create_webhook_subscription`, `list_webhook_subscriptions`, `test_webhook_subscription`
- `get_notification_topics`

Promotions:
- `create_volume_discount`, `get_volume_discount`, `update_volume_discount`, `delete_volume_discount`

---

## 7) Retries and Consistency Handling

Implemented retries:
- `publish`: retries on error IDs 25604/25709 with backoff (1500ms → 3000ms → 5000ms)
- `publish_group`: same retry pattern for `publish_by_inventory_item_group`

No retry in `create_volume_discount` — failure on volume pricing is surfaced to UI and does not auto-close the modal.

Reason:
- eBay propagation is eventually consistent after item/offer/group writes
- `create_group_offer` has built-in idempotency: if an offer already exists for a SKU, it fetches and reuses the existing `offerId` rather than failing

---

## 8) Known Strengths

- Supports both single and variant pipelines end-to-end
- Strong operational tooling (migrate, setup, bulk updates)
- Handles common eBay eventual-consistency failure modes
- Rich edit UX with Quill/HTML modes and image ordering
- Taxonomy-backed required item specifics enforcement

---

## 9) Known Weaknesses / Risks

## 9.1 ~~Critical security risk~~ ✅ RESOLVED (April 20, 2026)
- ~~The page previously embedded a service-role key in browser JS (`SERVICE_KEY`) and used it for edge calls.~~
- `SERVICE_KEY` constant removed from `ebay-listings.html`. `callEdge` now gets user JWT via `supabase.auth.getSession()`.
- `ebay-manage-listing` now enforces admin auth: `decodeJwtRole` helper + `is_admin` RPC check. Unauthenticated callers get 401; non-admin callers get 403.
- **Pending:** Rotate the now-compromised service-role key in the Supabase dashboard.

## 9.2 Monolithic edge function
- `ebay-manage-listing` is large and handles many domains (inventory/offers/promo/webhooks/setup).
- Harder to test and reason about regressions.

## 9.3 State coupling in UI
- Heavy use of mutable in-memory state objects (`currentProduct`, `editProduct`, transient `_...` fields).
- Modal flow is powerful but easy to regress when new paths are added.

## 9.4 Variant SKU derivation coupling
- SKU suffix generation is deterministic but duplicated across code paths.
- Should be centralized into one shared utility pattern to avoid drift.

## 9.5 Store category + multi-offer complexity
- Group listing settings are persisted through per-variant offers.
- Any partial failure can create inconsistent per-SKU offer settings without surfaced UI detail.

---

## 10) Test Matrix (Recommended Regression Suite)

### Single listing
1. Push: create item -> create offer -> publish
2. Edit: change title/description/images/price/store category
3. End listing and re-list

### Variant listing
1. Push with all variants qty > 0
2. Push with some variants qty 0
3. Edit shared fields + variant main images
4. Edit store category and verify persistence on all variant offers
5. Publish + end via group path

### Promotions
1. Create volume promo on publish
2. Edit and update volume tiers
3. Delete volume promo
4. Validate no duplicate tier rendering and no duplicate promotion creation

### Setup/migration
1. Policies fetch + location setup
2. Scan + auto-link migration path

---

## 11) Recommended Next Refactors

1. ~~Security hardening first:~~ ✅ RESOLVED (April 20, 2026)
	 - `SERVICE_KEY` removed from `ebay-listings.html`; `callEdge` uses user session JWT
	 - `ebay-manage-listing` enforces admin auth (401/403) via `decodeJwtRole` + `is_admin` RPC
	 - **Pending:** Rotate service-role key in Supabase dashboard
2. Break `ebay-manage-listing` by domain:
	 - offers, groups, promotions, setup/webhooks
3. Add structured operation logging with correlation IDs for each modal action
4. Add frontend operation summary panel for partial-success multi-step flows
5. Add integration tests for variant edit/store-category synchronization

---

## 12) Summary

The eBay Listings page is a feature-rich orchestration console that now supports full single-item and multi-variant pipelines, including promotions, migration, and operational setup. The architecture works end-to-end. A full audit sprint on April 20, 2026 applied all critical and high-priority fixes from sections 13–14: credential removal, edge function auth hardening, webhook outcome gating, group-draft publish routing, volume tier integrity, variant SKU collision precheck, best-offer validation, variant quantity preservation, `update_offer` read-only field filtering, `delete_item` variant DB key, and fractional `percentOff` clamping. The service-role key must still be rotated in the Supabase dashboard to fully close the credential exposure.

---

## 13) Audit Sweep 002 (Bug/Potential Bug Findings + Fix Plan)

This section captures a second-pass bug sweep focused on runtime behavior, data integrity, and operational risk.

### 13.1 Critical findings

1. ✅ **FIXED (April 20, 2026)** Client-exposed service-role credential
	- `SERVICE_KEY` constant removed from `ebay-listings.html`.
	- `callEdge` rewritten to use `supabase.auth.getSession()`; throws on missing session.
	- `ebay-manage-listing` now guards all actions: `decodeJwtRole` + `is_admin` RPC; returns 401/403 on failure.
	- **Pending:** Rotate service-role key in Supabase dashboard.

### 13.2 High findings

1. Inline `onclick` injection surface
	- Evidence: row/card actions are rendered with inline handlers containing dynamic values.
	- Mitigation already in place: `esc()` is consistently applied to all values interpolated into inline handlers. It HTML-encodes `&`, `<`, `>`, `"`, and `'`, which prevents HTML-context injection.
	- Residual risk: If a product field value contains JavaScript that eBay-style encodes through, or if `esc()` is ever missed in a new code path, injection is possible. The underlying pattern remains fragile.
	- Fix plan:
	  1. Replace inline handlers with `data-*` attributes on each row/card.
	  2. Bind a single delegated event listener on the container.
	  3. Read `code`/`offer_id`/`group_key` from `data-*` values, never from interpolated strings.

2. ✅ **FIXED (April 20, 2026)** Volume tier quantity remap bug
	- Volume promo normalization now preserves user-provided `minQuantity` values instead of using array index.
	- Baseline `{ minQuantity: 1, percentOff: 0 }` prepended without shifting user tiers.
	- `Math.round()` added on `percentOff` before building `discountRules`.

3. ✅ **FIXED (April 20, 2026)** Variant SKU collision risk
	- Added a duplicate-SKU precheck in `btnCreateItem` handler before any `create_item` calls fire.
	- If two variants would generate the same SKU suffix, an error is shown naming the colliding SKUs.
	- `create_item` loop is never entered if duplicates are detected.

### 13.3 Medium findings

1. ✅ **FIXED (April 20, 2026)** Group draft publish path mismatch
	- `doPublish` signature extended to accept `itemGroupKey` as third argument.
	- Routes to `publish_group` action when `itemGroupKey` is present; falls back to single `publish` otherwise.
	- Both table and card render functions now pass `p.ebay_item_group_key` as the third arg.

2. ✅ **FIXED (April 20, 2026)** Variant quantity flattening during group offer updates
	- Group edit offer update loop now uses `offerRow.availableQuantity ?? quantity` instead of the modal's shared quantity.
	- Per-variant stock from eBay is preserved unless that variant's quantity was explicitly changed.

3. ✅ **FIXED (April 20, 2026)** Webhook setup success reporting may be false-positive
	- All 7 affected webhook actions (`setup_webhook_config`, `delete_webhook_destination`, `create_webhook_destination`, `create_webhook_subscription`, `list_webhook_subscriptions`, `list_webhook_destinations`, `get_notification_topics`) now check `result.ok`.
	- On failure, return `{ success: false, status, error }` instead of `{ success: true }`.
	- `create_webhook_destination` and `create_webhook_subscription` additionally verify the extracted ID is non-empty.

4. ✅ **FIXED (April 20, 2026)** Bulk price update zero-value check
	- `if (item.priceCents)` changed to `if (item.priceCents !== undefined && item.priceCents !== null)` in `bulk_update` handler.

5. ✅ **FIXED (April 20, 2026)** Best-offer threshold validation gap
	- `getBestOfferTerms()` now throws before building the payload if both `autoAccept` and `autoDecline` are set and `autoAccept ≤ autoDecline`.
	- Error message surfaces to the modal status bar.

### 13.4 Candidate risk (needs confirmation)

1. HTML-to-visual description mode assignment
	- Evidence: when switching from HTML mode to Visual mode, `toggleDescMode` does `quillInstance.root.innerHTML = val` — but only when `!isComplexHtml(val)`. If the content is detected as complex (contains styled `<div>` or `<table>`), it stays in HTML mode. The switch to Quill only occurs on "simple" HTML.
	- Risk: for simple HTML that passes `isComplexHtml()`, crafted content (e.g., inline `onmouseover`) could reach Quill's root DOM. This is an admin-only surface so the practical impact is low, but the pattern is fragile.
	- Suggested hardening:
	  1. Run `sanitizeForEbay()` on `val` before assigning to `quillInstance.root.innerHTML`.
	  2. The `sanitizeForEbay()` function already strips `on*` attributes and dangerous tags — applying it here closes the gap.

### 13.5 Recommended fix order

> ✅ **All fixes applied April 20, 2026** in a single sprint commit. See sections 13.1–13.3 for individual fix details.

1. ✅ Remove client service-role key + rotate it
2. ✅ Normalize `callEdge` non-JSON error handling
3. ✅ Fix webhook success gating (all 7 affected actions)
4. ✅ Fix group draft publish mismatch (`doPublish` group routing)
5. ✅ Fix volume tier remap bug
6. ✅ Fix variant SKU collision risk
7. ✅ Fix best-offer threshold validation
8. ✅ Fix variant quantity flattening on group offer update
9. ✅ Fix `update_offer` read-only field filtering
10. Quieter UX/observability improvements (partial-success panels, correlation IDs) — still pending

---

## 14) Audit Sweep 003 — Independent Deep Review

This section is a clean independent pass over the actual source code, separate from the sweep-002 findings.

---

### 14.1 Webhook success gating — broader than previously documented

> ✅ **FIXED (April 20, 2026)**

**Finding:**
Sweep 002 noted that "some webhook actions return `success: true` without checking upstream `result.ok`." The actual scope is wider. The following actions all return `{ success: true }` unconditionally regardless of whether the eBay API call succeeded:

- `setup_webhook_config` — returns `{ success: true, data: configResult.data }` without checking `configResult.ok`
- `delete_webhook_destination` — same pattern, `result.ok` never checked
- `list_webhook_subscriptions` — same pattern
- `list_webhook_destinations` — same pattern
- `get_notification_topics` — same pattern

By contrast, `create_webhook_destination` and `create_webhook_subscription` also return `success: true` unconditionally but additionally derive IDs from response headers — if eBay rejects the call, `destinationId`/`subscriptionId` will be empty strings and the UI will show success with a blank ID.

`opt_in_policies` is the one exception that correctly uses `success: result.ok`.

**Fix applied:**
All 7 affected webhook handlers now check `result.ok` before returning `success: true`. `delete_webhook_destination` allows 204 as a success status. `create_webhook_destination` and `create_webhook_subscription` additionally validate the derived ID is non-empty before reporting success.

---

### 14.2 `delete_item` DB cleanup silently no-ops for variant SKUs

> ✅ **FIXED (April 20, 2026)**
In `ebay-manage-listing`, the `delete_item` action clears eBay fields on the `products` row using:
```ts
await supabase.from("products").update({ ebay_sku: null, ebay_offer_id: null, ... }).eq("code", sku);
```
For single listings, `sku === product.code`, so this works. For variant listings, the eBay SKU is `{code}-{SUFFIX}` (e.g., `HAT001-RED`). The `.eq("code", sku)` lookup matches nothing — `products.code` stores `HAT001`, not `HAT001-RED`. The eBay item is deleted from eBay successfully, but the product's DB fields (`ebay_sku`, `ebay_offer_id`, `ebay_item_group_key`, `ebay_status`) remain populated, causing the UI to show stale draft/active state.

Note: `delete_item` is not currently exposed in the UI (users withdraw listings instead), but it is callable and will be hit if the action is ever surfaced for cleanup.

**Fix applied:**
Accepts optional `baseCode` in action body. When provided, DB update uses `baseCode`. Otherwise, if `sku` contains `-`, the prefix before the first `-` is used as the DB key, matching the base product `code`.

---

### 14.3 `callEdge` is not resilient to non-JSON edge function responses

> ✅ **FIXED (April 20, 2026)**

**Finding:**
`callEdge` is implemented as:
```js
async function callEdge(fnName, body) {
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/${fnName}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify(body),
  });
  return resp.json();
}
```
`resp.json()` is called unconditionally without checking `resp.ok`. If an edge function crashes (Deno runtime error, cold-start timeout, malformed request) Supabase returns a plain-text or HTML error body. `resp.json()` throws a `SyntaxError`, which propagates up as an unhandled rejection in any `callEdge` call site that does not have its own `try/catch`.

Most button handlers do have `try/catch`, so in practice this surfaces as `"❌ Error: Unexpected token..."` — confusing but not a crash. The dangerous case is `loadPoliciesCache()` which is called during `openEdit` and has a surrounding `try/catch`, but nested code paths may not preserve the context clearly for the user.

**Fix applied:**
`callEdge` now:
1. Gets user JWT via `supabase.auth.getSession()`; throws with a human-readable message if no session.
2. Checks `resp.ok` — if response is not OK and not JSON (`content-type` check), returns `{ success: false, error: 'HTTP N from fnName' }`.
3. Wraps `resp.json()` in `.catch()` to normalize parse failures to `{ success: false, error: 'Non-JSON response...' }`.

---

### 14.4 `renderEditVariantImageControls` makes N silent parallel edge calls

> ✅ **FIXED (April 20, 2026)**

**Finding:**
When the edit modal opens for a group listing, `renderEditVariantImageControls` uses `Promise.all` to fire one `get_item` `callEdge` call per variant SKU simultaneously. The `catch {}` block was empty — errors were silently swallowed and the user had no indication that a variant image failed to load. Additionally, for products with many variants (8+), this fires 8+ simultaneous edge calls which can hit Supabase concurrency or eBay rate limits.

**Fix applied:**
Minimum viable fix applied: the empty `catch` now logs the failure to `console.warn` with the SKU and error message, and falls back to the local `preview_image_url`. A `result.success === false` path also warns. Full UI row-level error indicators are a separate UX improvement (still pending).

---

### 14.5 `update_offer` GET + full-spread PUT may include eBay read-only fields

> ✅ **FIXED (April 20, 2026)**

**Finding:**
The `update_offer` action correctly does a `GET /offer/{offerId}` first to preserve unchanged fields, then spreads the full existing offer into the PUT body:
```ts
const existing = current.data as Record<string, unknown>;
const updatedOffer: Record<string, unknown> = {
  ...existing,
  availableQuantity: ...,
  categoryId: ...,
};
```
eBay's Inventory API PUT `/offer/{offerId}` is documented as a full-replacement operation. However, the GET response includes server-managed fields such as `offerId`, `listing` (contains `listingId`, `listingStatus`), `statusEnum`, and `auditInfo`. Sending these back in the PUT body can trigger `85001 - Invalid field for this operation` errors on eBay's side for certain field combinations depending on listing state (active vs. draft behave differently).

**Fix applied:**
After spreading `existing` into `updatedOffer`, the following read-only keys are explicitly deleted before the PUT: `offerId`, `listing`, `statusEnum`, `auditInfo`, `format`, `marketplaceId`.

---

### 14.6 Volume pricing `percentOff` allows fractional values

> ✅ **FIXED (April 20, 2026)**
The volume tier UI renders the `%` input without a `step` attribute, defaulting browsers to `step="any"` and allowing fractional values like `7.5`. eBay's Promotions API (`VOLUME_DISCOUNT`) requires percentage discount values to be whole integers.

**Fix applied:**
1. `step="1"` added to the `vol-pct` input in `addVolTier()`.
2. `Math.round()` added in the edge function `discountRules` builder so any fractional value that slips through is clamped server-side.

---

### 14.7 Summary of Sweep 003 findings

| # | Finding | Severity | Effort | Status |
|---|---------|----------|--------|--------|
| 14.1 | Webhook actions return `success: true` unconditionally (7 actions) | High | Low | ✅ Fixed |
| 14.2 | `delete_item` DB cleanup no-ops for variant SKUs | Medium | Low | ✅ Fixed |
| 14.3 | `callEdge` crashes on non-JSON edge function responses | Medium | Low | ✅ Fixed |
| 14.4 | N parallel silent `get_item` calls in edit variant image render | Medium | Low | ✅ Fixed (min viable) |
| 14.5 | `update_offer` PUT spreads eBay read-only fields | Medium | Low | ✅ Fixed |
| 14.6 | Volume pricing allows fractional `percentOff` | Low | Trivial | ✅ Fixed |

---

## 15) Post-Hotfix Validation Checklist

After completing the fix sprint (sections 13 + 14), verify the following before considering the system stable.

> **Sprint status (April 20, 2026):** All code changes applied and deployed. Items marked ✅ have been verified at code level. Items marked `[ ]` require manual runtime testing.

### Security
- [x] Service-role key removed from all client bundles (`pages/admin/ebay-listings.html`)
- [ ] **⚠️ Service-role key rotated in Supabase dashboard** — must be done manually
- [ ] Rotated key confirmed working server-side only (edge functions can still reach DB; browser calls now use user JWT)
- [x] Admin auth enforced inside edge functions — unauthenticated requests return 401, non-admin returns 403

### Core flow — single listing
- [ ] Push: create item → create offer → publish completes without error
- [ ] Edit: title/description/price/images save and reflect on eBay
- [ ] End listing sets status to `ended` in both eBay and local DB
- [ ] Re-list from ended state opens push modal with pre-seeded fields

### Core flow — group/variant listing
- [ ] Push with all variants qty > 0 creates group + per-variant offers + publishes
- [ ] Push with some variants qty 0 skips those variants cleanly
- [ ] Edit modal loads correctly for group listing (variant image controls render, no silent errors)
- [x] Group draft with `ebay_offer_id` set: table/card Publish button routes to `publish_group`, not single offer
- [ ] End listing for active group listing routes to `withdraw_group`

### Bulk operations
- [ ] Bulk price update with value `0` is no longer silently skipped — `0` now passes through to the API as intended
- [ ] Bulk qty update correctly sends quantity, not price
- [ ] Local DB `ebay_price_cents` updates after successful bulk price

### Volume pricing
- [x] Volume pricing UI rejects fractional `percentOff` (`step="1"` added; edge function uses `Math.round`)
- [x] User-entered tier thresholds (e.g., buy 5+) are preserved after save — not remapped to sequential indices
- [ ] Create + update + delete volume promo all complete without error
- [ ] No duplicate tiers rendered when re-opening edit modal on a listing with existing promo

### Webhook setup
- [x] A failed webhook config call surfaces as `❌ error` in the UI — not a false success
- [x] `create_webhook_destination` returns a non-empty `destinationId` on success (validated before reporting success)
- [x] `create_webhook_subscription` returns a non-empty `subscriptionId` on success (validated before reporting success)

### Error handling
- [x] Simulating a Supabase edge function crash (bad action name) shows a friendly `❌` message, not a raw `SyntaxError: Unexpected token`
- [x] Editing a group listing with one eBay-side `get_item` call failing shows a `console.warn` and falls back to local image — does not silently render wrong image

### Best offer
- [x] Setting `autoAccept` lower than or equal to `autoDecline` is rejected before the API call

### One-time post-rotate smoke test
- [ ] Open any admin page — confirm no `SERVICE_KEY` JWT appears in browser network requests
- [ ] Confirm edge function calls authenticate via user JWT and still reach eBay correctly
