# Karry Kraze Task List

## Effort scale (open tasks)

Rough implementation difficulty and time for one developer familiar with this codebase.

| Level | Meaning | Typical time |
|-------|---------|--------------|
| **XS** | Trivial — copy, CSS tweak, small wiring | < 2 hours |
| **S** | Small — one screen or localized feature | ~half day |
| **M** | Medium — multiple files in one feature area | 1–2 days |
| **L** | Large — cross-module work, API/DB, or major UI | 3–5 days |
| **XL** | Extra large — new system, many integrations, or mostly blocked on external approval | 1+ weeks |

Open tasks are tagged inline, e.g. `- [ ] **M** Task name`.

---

## Priority 0 — Revenue, Orders, and Customer Experience

### Orders, Profit, Expenses, and Labels

- [x] Audit and update the Line Items Orders page for eBay orders so order summary cost and profit include eBay fees.
  - Include listing fees.
  - Include promoted listing / ad fees.
  - Review the current system.
  - Plan implementation for accurate profit and expense tracking.

- [x] Remove outdated Line Items Orders page features.
  - Import eBay
  - Re-match eBay
  - Import Pirate Ship
  - Export Ship Ready CSV
  - Related buttons and features

- [x] Add custom label prints per order.
  - Karry Kraze website orders should say “Thanks for ordering.”
  - Website order labels should include a QR code to leave a review and receive a discount.
  - Marketplace order labels should include a CTA about ordering directly from the website for a lower price.
  - Include a 15% discount for first website order.
  - Add analytics for tracking label performance.

- [x] Create or merge a product purchase page with expenses to get true CPI cost from Baestao XLS imports.
  - Parcel Imports v1 complete (import, map, approve CPI, receive inventory).

- [x] Make CPI reflected on Products page (`products.html`).
  - CPI column, variant landed CPI, margin badges, modal profit panel.

- [x] Make CPI reflected on Orders page (`orders.html` / Line Items workspace).
  - Workspace cost/profit + order summary views / KPIs.

- [ ] **M** Add a visual label preview on the orders modal.
  - Show the coupon / label situation for each order.
  - Preview the QR code, CTA, discount, and destination.

- [ ] **L** Shipping CTA scan tracking hub for label/QR metrics.
  - Extend beyond basic CTA label analytics if needed.

- [x] **S** Orders page platform toggle buttons (filter/split by Amazon, eBay, website, etc.).

- [x] **S** Orders list vs fulfillment status mismatch (shipped in table, delivered in workspace).
  - List uses shipment data from initial load; workspace re-fetches fresh `label_status` from `fulfillment_shipments` (e.g. Shippo webhook advanced shipped → delivered after list loaded).
  - Workspace header badge is set from stale list row before fetch and not updated after `fetchOrderDetails`.
  - Fulfillment tab also shows a separate green **Delivered** date tile when `delivered_at` is set — can look like “delivered” even if main status still says shipped.
  - Fix: refresh workspace header from fresh shipment after load; sync list row on workspace close/save; clarify delivered date vs status in fulfillment UI.
  - Root cause (data): Shippo `track_updated` could regress `label_status` after delivery while leaving `delivered_at` set. Guard added in `shippo-webhook`; backfill `20261108_fulfillment_heal_delivered_status.sql`.

- [ ] **M** Marketplace cancel/refund → KK orders DB sync (eBay first; Amazon later).
  - Example gap: `EBAY-06-14832-82203` — refunded/cancelled on eBay, KK still showed `shipped` with a Shippo label (no webhook tracking; sync never flipped status).
  - Policy: money refunds stay on the marketplace (eBay/Amazon). Do **not** use website Stripe refund for marketplace orders.
  - Strengthen eBay order/finance sync + webhook cancel-aware path so `CANCELED` / refunds set fulfillment to `cancelled` (or refunded) and update refund fields / observations.
  - After cancel sync: prompt to void unused Shippo label when one exists.
  - Add admin **Mark marketplace refund/cancel** override for cases where eBay refunds without a clean cancel payload (record-keeping only; does not move money).
  - Related: “Fix pending status on canceled orders”; “Cancelled orders should not count as unfulfilled”.

- [ ] **M** Search orders page by sold item / SKU — see all orders containing that item.

- [ ] **L** Upgrade item status page.
  - Average profit per order or per item.
  - List of orders where the item was sold.
  - Last sold date.

- [ ] **L** KK order address verification.
  - Auto-check on customer order; text customer with update link if invalid.
  - Or validate address before customer places order.

### Shipping, Orders, and Customer Messaging

- [x] **S** Send customers a text message when their website order ships.
  - Already wired on Shippo first `TRANSIT` scan via `shippo-webhook` → `send-sms` (`shipping_shipped`).
  - Fix: order lookup used non-existent `customer_name` (never sent). Now uses `first_name` / `last_name`; KK website sessions only.
- [x] **S** Log customer phone numbers in order details.
  - Already stored on `orders_raw.phone_number` (Stripe checkout) and shown in Orders workspace Overview.
- [x] **S** Fix pending status on canceled orders.
  - Example: `KKO-314754` — full refund `cancelled_before_ship` but `label_status` stayed `pending`.
  - Fix: expand `label_status` check (`20261110`); `stripe-refund` sets fulfillment to `cancelled`/`refunded` on full refund; heal pending canceled-before-ship rows.
- [x] **XS** Update `shipping.html` with more accurate information on how shipping works (7826 visual overhaul — KK theme, live free-shipping threshold, audited copy).
- [x] **S** Create `returns.html` and link it in the footer.
  - Policy: no product returns; refunds by request via Contact Us (website orders only).
  - eBay/Amazon: use marketplace return/refund tools.
  - Footer Help link already pointed at `/pages/returns.html`; page + `js/pages/returns/` added. FAQ return answers aligned.

### Expenses, Tax, and True Shop P&L

- [ ] **XL** Universal storage system.
  - Auto deduct stock on product sells.
  - Auto add stock on parcel import receive (partial — parcel receive exists; sell-side deduct TBD).

- [ ] **XL** More automated expenses.
  - Twilio, COGS, mileage for order drop-offs, OpenAI, Amazon, eBay, KK feeds, shipping supplies, Cursor, ChatGPT, Supabase, etc.

- [ ] **L** Revamp expenses page.
  - Subscriptions, Stripe costs, better organization.

- [ ] **M** Add Stripe fees into expenses automatically.
- [ ] **M** Ability to filter or split expenses to see true shop expense (order cost, advertising, profit).
- [ ] **L** Tax summary including eBay.
- [x] **S** Delete MyBudget page (no merge — personal tracker; Expenses stays KK-only).
  - Removed `pages/admin/myBudget.html`, admin dashboard tile, and admin-nav Budget links.

### Promotions and SMS

- [ ] **L** Upgrade the promotions page.
  - SMS promotions, website-wide promotions, coupons — separate but organized.
- [ ] **M** Page dedicated to SMS timeline (style view for outgoing SMS).
- [ ] **XL** Add OpenClaw for SMS features.
- [ ] **M** Investigate Twilio error code 30005 and prevent recurrence.
- [ ] **M** Twilio balance visibility from admin and auto-log as expense (pull cost from business account).

---

## Priority 1 — Admin Social / Auto-Posting System

### Admin Social Page

- [x] Socials page overhaul.
- [x] Learning for captions.
  - Deep Analysis learnings are now applied to Auto-Queue / Autopilot AI captions as soft guidance.
- [x] Fix Socials autopilot volume — round-robin fill requests full deficit (Phase 013).
- [x] Calendar post status clarity — ✓/⏳/✗ glyphs and past-day muting (Phase 013).
- [x] Publish reliability — carousel error passthrough + Facebook rate-limit retry (Phase 013).
- [ ] **M** Optional: carousel reliability monitoring — alert if carousel failure rate spikes over 7 days.
- [ ] **L** Learning for comments.
  - Determine whether comment patterns should be analyzed.
  - Decide if comment learning should affect captions, CTAs, hashtags, or content selection.
- [ ] **L** Hashtag learning improvement.
  - Add explore-vs-exploit behavior to Auto-Queue.
  - Keep brand tags and top learned tags.
  - Reserve one slot for under-tested or category-specific hashtag candidates.
  - Tag posts as `explore` in metadata.
  - Compare performance so the system does not only reinforce early winners.
- [ ] **XL** Begin OpenClaw integration for the Admin Social system.
  - Use OpenClaw for higher-level learning, recommendations, and optimization.
  - Start with read-only analysis before allowing automated changes.
- [ ] **L** On Socials page, add engagement tracker for Facebook and Pinterest.
- [ ] **L** Facebook and Pinterest insights sync for Growth / Analytics (Sync Insights is **Instagram-only** today).
  - `instagram-insights` edge + Analytics **Sync Insights** only updates `platform = instagram` rows in `social_posts`.
  - FB/PIN posts can be **posted** but `likes` / `reach` / `impressions` stay **0** — Growth Platform Breakdown correctly shows 0, not a Growth tab bug.
  - After IG sync, use **Growth → Refresh** to reload cached data (Analytics sync does not auto-refresh Growth).
  - Future: FB/PIN insights edge sync (or explicit “IG only” copy on Growth coverage footnote so operators are not misled).
- [x] **S** Socials page — better visuals for Pinterest Board Strategy section.
  - Restyled to `.cursor/rules/website-theme.mdc` (Amazon icon): soft header panel + thick-border cards/controls; Social Tailwind `kkpink` aligned to `#f58f86`.
- [ ] **XL** Admin Social page — full visual + file-structure revamp.
  - Visual: restyle entire `pages/admin/social.html` (all tabs, modals, connection strip) to `.cursor/rules/website-theme.mdc` with Amazon Listings as the icon — replace soft gray / purple-gradient chrome.
  - Structure: split oversized `social.html` and remaining fat modules per `.cursor/rules/js-file-structure.mdc` (page shell + `js/admin/social/` by tab/feature, ≤500 lines per file; CSS in `css/pages/admin/social.css`).
  - Scope includes Calendar, Image Pool, Boards (already partially done), Auto-Queue, Analytics, Growth, Carousel, and shared chrome.
  - Boards tab polish is a preview of the target look — do not treat it as the full revamp.
- [ ] **M** Improve Admin Social page and tab mobile compatibility.
  - Review tab layout.
  - Review Analytics tab.
  - Review Auto-Queue tab.
  - Review Image Pool and Boards tabs.
  - Confirm modals work on mobile.

---

## Priority 2 — Marketplace and API Integrations

- [ ] **XL** Amazon API integration (core admin live; SP-API identity / Restricted Data Access approval still pending).
- [x] Amazon SP-API privacy policy — buyer PII collection, processing, storage, use, sharing, and disposal (`pages/privacy.html`, July 2026).
- [x] Update the eBay API page so items with variants can have images set for each variant.
- [ ] **XL** Build a **new** Admin eBay Listings page heavily visually inspired by Amazon Listings (`pages/admin/amazon.html`).
  - Treat Amazon as the UX/layout reference: denser readable table, soft status/health pills, left severity accents, KPI/filter strip, quieter row actions (menu or compact controls), product thumb + meta hierarchy.
  - Keep KK brand tokens (`kkpink` / `kkpeach`, thick black chrome on page shell/header/filters) — do not copy Amazon’s soft-only gray admin look for the shell.
  - Prefer a new page/module surface (or full rebuild) over another patch pass on the current crowded table; migrate live eBay flows (push/edit/publish/import/reconcile) onto the new UI.
  - Current `ebay-listings.html` theme polish is interim only; this todo is the real Amazon-parity rebuild.
  - Also tracked under Visual overhaul + eBay admin backlog.
- [ ] **L** Admin eBay Listings — control markdown sales / discounts from the edit flow.
  - eBay blocks `updateOffer` (category, policies, price, Best Offer) while a listing is in an active markdown/sale (e.g. 15% off). Today operators must end/remove the sale in Seller Hub → Marketing first.
  - Add UI to see if a listing is in a markdown sale, end/remove it from the sale, save listing edits (category etc.), then optionally re-apply the sale.
  - Use Marketing API `item_price_markdown` / promotions (separate from existing volume-pricing `item_promotion` support).
  - Do not rely on Promoted Listings ads for this — ads are not the blocker; markdown/sale is.
- [ ] **S** Product Amazon URL linked to Amazon listing page automatically.
  - Docs: `docs/pages/product/feature/amazonSync/CurrentFlow.md` (current manual flow)
  - Roadmap: `docs/pages/product/feature/amazonSync/flow/00_storefront_amazon_url_sync_roadmap.md`
- [ ] **M** On Amazon and eBay pages, mark items as website-only (not sellable on marketplace).
- [ ] **S** Bundle the funny heads-or-tails coin with bronze and silver variants — Amazon and eBay only (not website).
  - Attach as a marketplace bundle/add-on for the bronze and silver coin variants.
  - Do not offer this bundle on the KK storefront.
- [ ] **L** Sync eBay reviews to website reviews so eBay reviews can show on the website.

---

## Priority 3 — Public Website Updates

### Public Pages and Navigation

- [x] Create a social media page.
  - Public page: `/pages/social.html`
  - Instagram primary
  - TikTok and Pinterest included
  - Footer **Follow Us** links to the social page
  - Platform icon URLs use `js/shared/socialLinks.js`
- [x] **S** Update footer category links so they go to the Shop All page and filter by category.
- [x] Remove the slash for items that are out of stock / backorder.
- [x] Footer hyperlink fix — centralized social URLs via `js/shared/socialLinks.js`; **Follow Us** → `/pages/social.html`.

### Notifications and PWA

- [x] Web push notifications — subscription flow, admin new-order push, admin composer (`js/shared/pwa.js`, `send-push-notification` edge function).
- [ ] **M** Customer push for order shipped / review reminder (extend existing push system).

---

## Visual overhaul — website theme pass

Bring every surface in line with [`.cursor/rules/website-theme.mdc`](../.cursor/rules/website-theme.mdc). **Canonical icon:** Admin Amazon Listings (`pages/admin/amazon.html`) — thick black borders, heavy uppercase type, `kkpink` / `kkpeach`, sharp controls, no soft gray/purple admin chrome.

When restyling a page: match Amazon header/buttons/labels first; keep page JS within `.cursor/rules/js-file-structure.mdc` limits; prefer Tailwind + `css/theme/*` over one-off card systems.

### Shared chrome

- [ ] **M** Visual overhaul: public navbar (`page_inserts/navbar.html` + related).
- [ ] **M** Visual overhaul: public footer (`page_inserts/footer.html`).
- [ ] **M** Visual overhaul: admin nav / page shell (`page_inserts/admin-nav.html` + admin layout chrome).

### Public — storefront

- [ ] **L** Visual overhaul: Home (`index.html` + home inserts). Carousel/banner direction TBD — see Back Burner.
- [ ] **L** Visual overhaul: Catalog / Shop All (`pages/catalog.html`).
- [ ] **XL** Visual overhaul: Product details (`pages/product.html`) — also tracked under Public website — product page.
- [ ] **L** Visual overhaul: Checkout (`pages/checkout.html`).
- [ ] **M** Visual overhaul: Order success (`pages/success.html`).
- [ ] **M** Visual overhaul: Coupon / CTA landing (`pages/coupon.html`).
- [ ] **M** Visual overhaul: My Orders (`pages/my-orders.html`).
- [ ] **M** Visual overhaul: Leave a review (`pages/leave-review.html`).
- [ ] **M** Visual overhaul: Reviews (`pages/reviews.html`).
- [ ] **M** Visual overhaul: Public Social (`pages/social.html`).
- [ ] **M** Visual overhaul: SMS signup (`pages/sms-signup.html`).

### Public — info & legal

- [x] **M** Visual overhaul: Shipping (`pages/shipping.html`) — done (7826).
- [ ] **M** Visual overhaul: Returns (`pages/returns.html`).
- [ ] **M** Visual overhaul: FAQ (`pages/faq.html`).
- [ ] **M** Visual overhaul: Contact (`pages/contact.html`).
- [ ] **S** Visual overhaul: Privacy (`pages/privacy.html`).
- [ ] **S** Visual overhaul: Data deletion (`pages/data-deletion.html`).
- [ ] **S** Visual overhaul: 404 (`404.html`).
- [ ] **S** Visual overhaul: Offline / PWA fallback (`offline.html`).

### Admin — core ops

- [ ] **M** Visual overhaul: Admin dashboard (`pages/admin/index.html`).
- [ ] **S** Visual overhaul: Admin login (`pages/admin/login.html`).
- [ ] **S** Visual overhaul: Admin password reset (`pages/admin/reset.html`).
- [ ] **L** Visual overhaul: Products (`pages/admin/products.html`).
- [ ] **L** Visual overhaul: Inventory (`pages/admin/inventory.html`).
- [ ] **L** Visual overhaul: Line Items Orders (`pages/admin/lineItemsOrders.html`).
- [ ] **M** Visual overhaul: Line Items Raw (`pages/admin/lineItemsRaw.html`).
- [ ] **L** Visual overhaul: Parcel Imports (`pages/admin/parcelImports.html`).
- [ ] **M** Visual overhaul: Expenses (`pages/admin/expenses.html`).
- [ ] **M** Visual overhaul: Customers (`pages/admin/customers.html`).
- [ ] **M** Visual overhaul: Reviews admin (`pages/admin/reviews.html`).
- [ ] **M** Visual overhaul: Promotions (`pages/admin/promotions.html`).
- [ ] **M** Visual overhaul: Categories (`pages/admin/categories.html`).
- [ ] **M** Visual overhaul: Home categories (`pages/admin/homeCats.html`).
- [ ] **M** Visual overhaul: Banners (`pages/admin/banners.html`).
- [ ] **M** Visual overhaul: Looks / Shop the Look (`pages/admin/looks.html`).
- [ ] **M** Visual overhaul: Settings (`pages/admin/settings.html`).

### Admin — marketplaces & social

- [ ] **S** Visual audit: Amazon Listings (`pages/admin/amazon.html`) — canonical icon; polish gaps only, do not restyle away from the reference.
- [ ] **XL** Visual overhaul / rebuild: eBay Listings — new Amazon-inspired page (see Priority 2). Current page polish is interim.
- [ ] **XL** Visual overhaul: Admin Social (`pages/admin/social.html`) — also tracked under Priority 1 Admin Social.

### Admin — analytics & tools

- [ ] **M** Visual overhaul: Analytics (`pages/admin/analytics.html`).
- [ ] **M** Visual overhaul: Item stats (`pages/admin/item-stats.html`).
- [ ] **M** Visual overhaul: SMS analytics (`pages/admin/sms-analytics.html`).
- [ ] **M** Visual overhaul: Tax (`pages/admin/tax.html`).
- [ ] **M** Visual overhaul: Tax 1065 (`pages/admin/tax-1065.html`).
- [ ] **M** Visual overhaul: Profit calculator (`pages/admin/pCalc.html`).
- [ ] **M** Visual overhaul: Photo storage (`pages/admin/pStorage.html`).

---

## Back Burner

- [ ] **L** Home page carousel / banner full revamp (direction TBD — not a small style tweak).
- [ ] **L** Amazon push flow improvement (brainstorm / UX pass) — direction TBD.
  - Possible: auto-load requirements when product type is chosen via Recommend / Search select (not free-text typing); AI already loads requirements today.
  - Possible: fewer manual steps between type → attributes → preview → submit.
  - Keep Load Requirements for refresh / debug.

---

## Completed Milestones (archive)

- [x] eBay Line Items Orders profit audit and update
- [x] Line Items Orders outdated import/export button cleanup
- [x] Custom CTA label prints per order
- [x] Parcel Imports v1 — Baestao XLS import, landed CPI approval, inventory receive
- [x] Landed CPI on Products page (CPI column, margins, modal)
- [x] Landed CPI on Orders workspace and order summary views
- [x] Public social media page
- [x] Socials page overhaul
- [x] Admin Social caption learning loop
- [x] Remove unavailable slash for out-of-stock / backorder variants
- [x] eBay variant images per variant
- [x] Amazon SP-API privacy policy (Restricted Data Access disclosure)
- [x] Footer social hyperlink fix (`socialLinks.js`, Follow Us)
- [x] Web push notifications (subscription, admin new-order, composer)
- [x] Cursor project rules — brand theme + image prompts (`.cursor/rules/`)
- [x] Shipping page visual overhaul — `pages/shipping.html` + `js/pages/shipping/` (7826; accurate rates/timelines, live threshold, KK theme)

## Backlog — Sorted by area

### AI & brand content

- [x] Cursor rules — brand theme (`.cursor/rules/website-theme.mdc`) + JS/docs structure rules.
- [x] Cursor image prompt rules for product angles, infographics, and branding (`img-prompt-*.mdc`).

### Security & infrastructure

- [ ] **L** Address security threats from Cloudflare, GitHub, and Supabase

### Amazon admin

- [ ] **M** Active listings: group/collapse by parent SKU; fix More Options menu showing disabled actions on parent SKUs.
- [ ] **M** AI fill should fill every optional slot and/or add radio or checkboxes for which sections to use AI on
- [x] **XS** Click listing SKU, name, or ASIN to open the Amazon listing page
- [x] **XS** Click listing SKU, name, or ASIN to open the KK product page
- [x] **XS** Clicking outside the push modal should not close it
- [ ] **M** Dropdown feature for parent and child variation rows
- [x] **XS** Fix bottom rounded corners on the push modal
- [ ] **M** Fix Item Highlight attribute error (`This attribute 'Item Highlight' is currently unsupported`)
- [x] **S** Highlight missing attributes on Preview Amazon Submit
- [ ] **M** Load Requirements should load all requirements for the product type before preview (no surprise missing fields on preview submit)
- [x] **S** Product push: enforce Amazon title max length (Item Highlights update)
- [x] **S** Submit to Amazon button should close and return to the push product modal flow
- [ ] **M** What happens to Amazon listings if product content is deleted or altered from the KK products page?
- [ ] **M** When parent is pushed, pushing a child should reuse entries and settings from the parent during push

### Orders & parcels

- [ ] **S** Cancelled orders should not count as unfulfilled unless partial refund (never-shipped orders should not count toward unfulfilled)
- [x] **S** Parcel import: charged weight and USD total estimate not showing correctly on previous parcel imports
- [ ] **M** Parcel import: handle items bought for personal use (not inventory)
- [ ] **L** Parcel import: new tab with parcel summary — fiscal breakdown (item, weight, % of parcel, cost, CPI, new average CPI, total weight, yuan cost, USD cost)
- [x] **S** Parcel import: setting charged weight in review should reflect in the upload tab during editing (not only after submission)
- [x] **S** Parcel import: setting total actual parcel charge should reflect in parcel summary
- [ ] **L** Parcel import: support for supplies (tape, labels, boxes, etc.) with CPI cost — maybe a supplies page

### eBay admin

- [ ] **XL** New Admin eBay Listings page heavily inspired by Amazon Listings (see Priority 2) — readable table density, soft row signals, Amazon-like actions; KK shell chrome
- [ ] **L** Control eBay markdown sales/discounts from Admin eBay Listings (see Priority 2) — end/remove/re-apply so category and other offer edits work without Seller Hub

### Products (admin)

- [x] **XS** Catalog hover images — verify they actually work
- [ ] **M** Combine primary image and catalog image?
- [ ] **M** CPI: default estimate = average CPI across all variants when parcel import data exists per variant
- [ ] **M** CPI: overridden by parcel imports; otherwise fallback to default CPI from product cost and weight in basics panel
- [x] **XS** Rename product CPI section to **Product Cost** in product details
- [ ] **S** Disable or remove manual inventory editing on the admin Products page — all stock adjustments go through the Inventory page only.

### Inventory (admin)

- [ ] **M** Inventory page: multi-select line items and apply bulk edits.

### Public website — product page

- [ ] **M** Add **Product Informant** section (manually filled from product details, like description/details)
- [ ] **M** Add **Product Post** section above product details — 3×1 grid of most recent social post for that product (links to admin socials)
- [ ] **M** Change product details to horizontal buttons instead of dropdowns (description open by default; click to open others)
- [ ] **M** Change row/thumbnail images to vertical layout instead of under the main image
- [ ] **M** Customer reviews: shorten summary reviews to make room for carousel of customer product photos
- [ ] **S** Line item reviews: move image to the right of review text
- [x] **XS** Move **Pairs Well With** above customer reviews
- [ ] **M** Pairs Well With: add product rating, **View Product** button (or **Add to Cart** on same product; auto-scroll/highlight variants if not selected)
- [ ] **S** Sticky details column: deactivate sticky when it reaches the next section
- [ ] **XL** Visual overhaul for product details page (match upgraded Amazon admin visuals)



ability to search items by tags on admin panel products page