# Karry Kraze Task List

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

- [ ] Add a visual label preview on the orders modal.
  - Show the coupon / label situation for each order.
  - Preview the QR code, CTA, discount, and destination.

- [ ] Shipping CTA scan tracking hub for label/QR metrics.
  - Extend beyond basic CTA label analytics if needed.

- [ ] Orders page platform toggle buttons (filter/split by Amazon, eBay, website, etc.).

- [ ] KK order address verification.
  - Auto-check on customer order; text customer with update link if invalid.
  - Or validate address before customer places order.

### Shipping, Orders, and Customer Messaging

- [ ] Send customers a text message when their website order ships.
- [ ] Log customer phone numbers in order details.
- [ ] Fix pending status on canceled orders.
- [ ] Update `shipping.html` with more accurate information on how shipping works.
- [ ] Create `returns.html` and link it in the footer.

### Expenses, Tax, and True Shop P&L

- [ ] Universal storage system.
  - Auto deduct stock on product sells.
  - Auto add stock on parcel import receive (partial — parcel receive exists; sell-side deduct TBD).

- [ ] More automated expenses.
  - Twilio, COGS, mileage for order drop-offs, OpenAI, Amazon, eBay, KK feeds, shipping supplies, Cursor, ChatGPT, Supabase, etc.

- [ ] Revamp expenses page.
  - Subscriptions, Stripe costs, better organization.

- [ ] Add Stripe fees into expenses automatically.
- [ ] Ability to filter or split expenses to see true shop expense (order cost, advertising, profit).
- [ ] Tax summary including eBay.
- [ ] Delete MyBudget page (merge/replace with revamped expenses).

### Promotions and SMS

- [ ] Upgrade the promotions page.
  - SMS promotions, website-wide promotions, coupons — separate but organized.
- [ ] Page dedicated to SMS timeline (style view for outgoing SMS).
- [ ] Add OpenClaw for SMS features.

---

## Priority 1 — Admin Social / Auto-Posting System

### Admin Social Page

- [x] Socials page overhaul.
- [x] Learning for captions.
  - Deep Analysis learnings are now applied to Auto-Queue / Autopilot AI captions as soft guidance.
- [x] Fix Socials autopilot volume — round-robin fill requests full deficit (Phase 013).
- [x] Calendar post status clarity — ✓/⏳/✗ glyphs and past-day muting (Phase 013).
- [x] Publish reliability — carousel error passthrough + Facebook rate-limit retry (Phase 013).
- [ ] Optional: carousel reliability monitoring — alert if carousel failure rate spikes over 7 days.
- [ ] Learning for comments.
  - Determine whether comment patterns should be analyzed.
  - Decide if comment learning should affect captions, CTAs, hashtags, or content selection.
- [ ] Hashtag learning improvement.
  - Add explore-vs-exploit behavior to Auto-Queue.
  - Keep brand tags and top learned tags.
  - Reserve one slot for under-tested or category-specific hashtag candidates.
  - Tag posts as `explore` in metadata.
  - Compare performance so the system does not only reinforce early winners.
- [ ] Begin OpenClaw integration for the Admin Social system.
  - Use OpenClaw for higher-level learning, recommendations, and optimization.
  - Start with read-only analysis before allowing automated changes.
- [ ] On Socials page, add engagement tracker for Facebook and Pinterest.
- [ ] Socials page — better visuals for Pinterest Board Strategy section.
- [ ] Improve Admin Social page and tab mobile compatibility.
  - Review tab layout.
  - Review Analytics tab.
  - Review Auto-Queue tab.
  - Review Image Pool and Boards tabs.
  - Confirm modals work on mobile.

---

## Priority 2 — Marketplace and API Integrations

- [ ] Amazon API integration.
- [x] Update the eBay API page so items with variants can have images set for each variant.
- [ ] Revamp eBay page to resemble Amazon page.
- [ ] Product Amazon URL linked to Amazon listing page automatically.
- [ ] On Amazon and eBay pages, mark items as website-only (not sellable on marketplace).
- [ ] Sync eBay reviews to website reviews so eBay reviews can show on the website.

---

## Priority 3 — Public Website Updates

### Public Pages and Navigation

- [x] Create a social media page.
  - Public page: `/pages/social.html`
  - Instagram primary
  - TikTok and Pinterest included
  - Footer **Follow Us** links to the social page
  - Platform icon URLs use `js/shared/socialLinks.js`
- [ ] Update footer category links so they go to the Shop All page and filter by category.
- [ ] Update banner style for the home page.
- [x] Remove the slash for items that are out of stock / backorder.

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

## Backlog — Sorted by area

### Security & infrastructure

- [ ] Address security threats from Cloudflare, GitHub, and Supabase

### Amazon admin

- [ ] AI fill should fill every optional slot and/or add radio or checkboxes for which sections to use AI on
- [ ] Click listing SKU, name, or ASIN to open the Amazon listing page
- [ ] Click listing SKU, name, or ASIN to open the KK product page
- [ ] Clicking outside the push modal should not close it
- [ ] Dropdown feature for parent and child variation rows
- [ ] Fix bottom rounded corners on the push modal
- [ ] Fix Item Highlight attribute error (`This attribute 'Item Highlight' is currently unsupported`)
- [ ] Highlight missing attributes on Preview Amazon Submit
- [ ] Load Requirements should load all requirements for the product type before preview (no surprise missing fields on preview submit)
- [ ] Pin product type / category on the push modal (cannot find button and pins)
- [ ] Product push: enforce Amazon title max length (Item Highlights update)
- [ ] Product push: requirements auto-load when product type is selected
- [ ] Submit to Amazon button should close and return to the push product modal flow
- [ ] What happens to Amazon listings if product content is deleted or altered from the KK products page?
- [ ] When parent is pushed, pushing a child should reuse entries and settings from the parent during push

### eBay admin

- [ ] Remake eBay page to visually reflect the Amazon page

### Orders & parcels

- [ ] Cancelled orders should not count as unfulfilled unless partial refund (never-shipped orders should not count toward unfulfilled)
- [ ] Parcel import: charged weight and USD total estimate not showing correctly on previous parcel imports
- [ ] Parcel import: handle items bought for personal use (not inventory)
- [ ] Parcel import: new tab with parcel summary — fiscal breakdown (item, weight, % of parcel, cost, CPI, new average CPI, total weight, yuan cost, USD cost)
- [ ] Parcel import: setting charged weight in review should reflect in the upload tab during editing (not only after submission)
- [ ] Parcel import: setting total actual parcel charge should reflect in parcel summary
- [ ] Parcel import: support for supplies (tape, labels, boxes, etc.) with CPI cost — maybe a supplies page

### Products (admin)

- [ ] Catalog hover images — verify they actually work
- [ ] Combine primary image and catalog image?
- [ ] CPI: default estimate = average CPI across all variants when parcel import data exists per variant
- [ ] CPI: overridden by parcel imports; otherwise fallback to default CPI from product cost and weight in basics panel
- [ ] Rename product CPI section to **Product Cost** in product details

### Public website — product page

- [ ] Add **Product Informant** section (manually filled from product details, like description/details)
- [ ] Add **Product Post** section above product details — 3×1 grid of most recent social post for that product (links to admin socials)
- [ ] Change product details to horizontal buttons instead of dropdowns (description open by default; click to open others)
- [ ] Change row/thumbnail images to vertical layout instead of under the main image
- [ ] Customer reviews: shorten summary reviews to make room for carousel of customer product photos
- [ ] Line item reviews: move image to the right of review text
- [ ] Move **Pairs Well With** above customer reviews
- [ ] Pairs Well With: add product rating, **View Product** button (or **Add to Cart** on same product; auto-scroll/highlight variants if not selected)
- [ ] Sticky details column: deactivate sticky when it reaches the next section
- [ ] Visual overhaul for product details page (match upgraded Amazon admin visuals)
