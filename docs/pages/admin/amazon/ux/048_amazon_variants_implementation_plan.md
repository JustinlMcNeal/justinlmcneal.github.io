# Amazon Variants — Strategy & Implementation Plan

> **Status:** Phase 1–3 shipped (2026-05-31). Variants infrastructure, variation families, and polish/recovery complete.  
> **Page:** `/pages/admin/amazon.html`  
> **Last updated:** 2026-05-31  
> **Related:** [`011_data_model_and_sync_strategy.md`](011_data_model_and_sync_strategy.md), [`012_official_sp_api_research.md`](012_official_sp_api_research.md), [`028_ready_to_push_live.md`](028_ready_to_push_live.md), eBay reference [`js/admin/ebayListings/variantPanel.js`](../../../../js/admin/ebayListings/variantPanel.js)

---

## 1. Problem statement

KK products can have multiple **active variants** (`product_variants`: Color, Size, etc.). The Amazon admin page today is **product-level only**:

| Behavior today | Effect |
|----------------|--------|
| Ready to Push excludes a product when **any** `mapped` row exists for `kk_product_id` | After pushing one variant (e.g. heart clasp), the product disappears from Ready to Push |
| Push modal uses one seller SKU (`products.code`, e.g. `KK-0018`) | Only one listing is created; other variants are not represented |
| Stock / price in push & compare | Aggregated across all variants |
| `amazon_listing_mappings` | Links listing → `kk_product_id` only (no `kk_variant_id`) |

**Example:** Heart clasp hook has multiple colors. One color was pushed as a standalone listing. The other color never appears in Ready to Push, even though it should be sellable on Amazon.

---

## 2. Amazon variation models (two valid paths)

### Option A — Standalone child SKUs

Each KK variant becomes its **own Amazon listing** with its own seller SKU and (usually) its own ASIN/product page.

- Seller SKUs: `KK-0018-SILVER`, `KK-0018-GOLD`, or `product_variants.sku`
- No parent listing required
- **Customer UX:** separate Amazon product pages per color
- **Build complexity:** lower
- **Good for:** quick rollout, fallback when variation family fails, truly distinct products

### Option B — Variation family (parent + children)

One **parent** listing (often not directly buyable) plus **child** listings per variant, linked on one product page with a dropdown (Color, Size, etc.).

- SP-API attributes: `parentage_level`, `variation_theme`, `child_parent_sku_relationship`
- Backend already exposes these in push extra attributes (`pushDraftAttributes.js`)
- **Customer UX:** matches what shoppers expect for “same item, different color”
- **Build complexity:** higher (parent first, theme validation, per product-type rules)
- **Good for:** heart clasp colors, size runs, apparel-style catalog

### Recommendation

| Layer | Choice |
|-------|--------|
| **End goal for multi-variant products** | **Option B** (one PDP with variant selector) |
| **First implementation slice** | Variant-level **infrastructure** (required for both A and B) |
| **Fallback** | Option A standalone push when family submit fails or product is single-SKU |

We are **not** choosing A *instead of* B long term. We build shared variant plumbing first, then wire **Option B submit** for products like KEYCHAIN. Option A remains a safety valve.

---

## 3. Current codebase touchpoints

### Ready to Push

- View: `v_amazon_ready_to_push_products` (`20260728`, `20260730`)
- Excludes product if:

```sql
EXISTS (
  SELECT 1 FROM amazon_listing_mappings m
  WHERE m.kk_product_id = p.id AND m.mapping_status = 'mapped'
)
```

### Push modal

- `fetchKkProductForPush()` loads product + gallery; **no variant panel**
- Seller SKU: `#amazonPushSellerSku` ← `row.kk_sku` / product code
- Submit: one draft / one listing per push

### Mapping

- `amazon_listing_mappings`: `amazon_listing_id`, `kk_product_id`, `kk_sku` — no variant FK

### Backend (variation hooks exist, UI does not)

- `amazonListingPayloadUtils.ts`: `parentage_level`, `child_parent_sku_relationship`, `variation_theme`
- `pushDraftAttributes.js`: hints for parent/child fields
- `011_data_model_and_sync_strategy.md` §8: “Plan parent ASIN + child seller SKU model”

### eBay precedent (reuse patterns)

- `variantPanel.js`, `getCheckedVariants()`, per-variant SKU pattern `{baseCode}-{COLOR}`
- Item group create flow in `ebayListings/index.js`

---

## 4. Target data model changes

### 4.1 Schema additions

| Table | Change |
|-------|--------|
| `amazon_listing_mappings` | Add nullable `kk_variant_id uuid REFERENCES product_variants(id)` |
| `amazon_listing_drafts` | Add nullable `kk_variant_id`, optional `variation_role` (`standalone` \| `parent` \| `child`), `parent_draft_id`, `variation_theme` |
| `amazon_listings` | Optional `kk_variant_id` denormalized for workspace queries |
| Indexes | Partial unique: one **mapped** row per `(kk_product_id, kk_variant_id)` when variant_id set; one per product when single-variant |

### 4.2 Ready to Push view (variant-aware)

Replace product-level exclusion with **variant-level coverage**:

- Emit one row per **product** with summary: `variants_total`, `variants_mapped`, `variants_ready`
- Or emit one row per **unmapped variant** (clearer for push UX)
- Product stays in Ready to Push while **any active variant** lacks a mapped Amazon listing
- Single-variant products: behavior unchanged (treat as one implicit variant)

**Eligibility flags** (`has_stock`, etc.) should use **variant stock** when row is variant-scoped, not sum of all variants.

### 4.3 Mapping rules

| Amazon listing | KK link |
|----------------|---------|
| Child SKU `KK-0018-SILVER` | `kk_product_id` + `kk_variant_id` |
| Parent SKU `KK-0018-PARENT` | `kk_product_id`, `kk_variant_id` NULL, `variation_role = parent` |
| Legacy standalone (no variant) | `kk_product_id` only |

---

## 5. Implementation phases

### Phase 1 — Variant infrastructure (foundation)

**Goal:** Fix Ready to Push + mapping so second variants can be pushed at all.

1. Migration: `kk_variant_id` on mappings + drafts
2. Rebuild `v_amazon_ready_to_push_products` (variant-aware exclusion)
3. Push modal: load `product_variants`; show variant selector (port eBay panel patterns)
4. Default seller SKU: `variant.sku` OR `{product.code}-{abbrev(option_value)}`
5. Quantity: variant stock, not product aggregate
6. Images: prefer `variant.preview_image_url` when set
7. Synced workspace: optional “Variant” column (`Color: Silver`)

**Test case:** Heart clasp — after Phase 1, unmapped color appears in Ready to Push; push as standalone child (Option A) to validate plumbing.

**Estimated effort:** 1–2 focused sessions.

### Phase 2 — Variation family submit (Option B)

**Goal:** One Amazon product page with color (or size) dropdown.

1. Product-type check: load PTD enums for `variation_theme` on KEYCHAIN (and others)
2. Push flow modes in modal:
   - **Single SKU** (current behavior)
   - **Start variation family** → creates parent draft + first child
   - **Add child to existing family** → link to parent seller SKU / parent draft
3. Payload builder:
   - Parent: `parentage_level = parent`, `variation_theme = COLOR` (example), no offer or minimal
   - Child: `parentage_level = child`, `child_parent_sku_relationship`, variant-specific attributes (`color` if required)
4. Submit ordering: parent ACCEPTED (or VALID) before children
5. Store `relationships` from sync into `amazon_listings.relationships` for UI

**Test case:** Heart clasp — parent + Silver (existing) + add Gold child linked to same family.

**Estimated effort:** 2–4 sessions (product-type edge cases).

**Shipped (2026-05-31):**
- Push modal **Amazon Variation Family** panel (standalone / parent / child) for multi-variant products
- Parent SKU + variation theme fields; child auto-fills `color` from KK variant when theme includes COLOR
- Draft columns: `variation_role`, `parent_draft_id`, `parent_seller_sku`, `variation_theme`
- Payload builder: proper SP-API shapes for `variation_theme`, `child_parent_sku_relationship`; parent listings omit offer/qty
- Live submit blocks child drafts until parent draft is submitted with ACCEPTED/VALID status

**Workflow (heart clasp example):**
1. Ready to Push → use the **Variation parent** row (`KK-0018-PARENT`) → save, preview, submit parent
2. Push second color → choose **Child listing** on a variant row → link parent SKU → save, preview, submit child
3. Repeat child step for remaining colors (or **Push remaining** on the product group header)

**Ready to Push parent shell (2026-06-02):** Multi-variant products get a dedicated `parent_shell` row in `v_amazon_ready_to_push_products`. Parent drafts no longer mark every color row as drafted (fixes hidden **Push remaining**). Apply migration `20260602_amazon_ready_to_push_parent_shell.sql`.

### Phase 3 — Polish & recovery

**Shipped (2026-05-31):**
- Ready to Push product groups with **X/Y variants on Amazon** progress
- **Push remaining (N)** bulk queue — saves drafts sequentially through unmapped variants
- Synced row action **Link to Variation Family** for mapped variant listings (opens child draft flow)
- Price/inventory compare shows **KK · {variant}** when a variant mapping exists

- [x] Ready card: “1/2 variants on Amazon”
- [x] Bulk “push remaining variants”
- [x] Convert standalone child → join existing family (via Link to Variation Family draft flow)
- [x] Inventory/price compare per variant row in Synced tab

---

## 6. Heart clasp recovery (interim)

Until Phase 1–2 ship:

| Approach | Notes |
|----------|-------|
| Manual second SKU in Seller Central | Map via Needs Mapping; product-level mapping only today |
| Split KK products per color | Works with current admin; duplicates catalog — avoid long term |
| Wait for Phase 1 | Push second color with correct variant SKU from KK admin |

After Phase 2: add Gold as **child** linked to existing family (or create parent retroactively if Amazon allows).

---

## 7. SP-API references

| Topic | Doc |
|-------|-----|
| Variation attributes | PTD schema for product type (e.g. `KEYCHAIN`) |
| `parentage_level` | `PARENT` / `CHILD` / `NONE` |
| `variation_theme` | Product-type-specific enum (e.g. `COLOR`) |
| `child_parent_sku_relationship` | Links child seller SKU to parent |
| Listings Items API | PUT/PATCH per seller SKU (same as today) |

See [`012_official_sp_api_research.md`](012_official_sp_api_research.md) § variation / relationships.

---

## 8. Open questions (resolve in Phase 2 spike)

1. Does **KEYCHAIN** support `variation_theme = COLOR` (or `COLOR_NAME`)? Verify via PTD before building UI.
2. Can a **standalone child already live** be converted into a family without delisting?
3. Parent listing: buyable or catalog-only for this product type?
4. Per-child images vs shared main image — KEYCHAIN image rules (see image suppression issues on KK-0066).
5. Should `product_variants.sku` be required before Amazon push (recommended: yes for multi-variant)?

---

## 9. Success criteria

- [x] Multi-variant product remains in Ready to Push until **all** active variants are mapped
- [x] Push modal selects variant(s) with correct SKU, stock, and images
- [x] Synced tab shows which KK variant each Amazon SKU represents
- [x] Variation family: one PDP with dropdown for heart clasp (Option B)
- [x] Standalone push still works for single-SKU products and as fallback

---

## 10. Related docs & tracking

- Milestone checklist: add row under Phase 6 or new **Phase 7 — Variants** when work starts
- Orders (separate track): [`049_amazon_orders_line_items_plan.md`](049_amazon_orders_line_items_plan.md)
