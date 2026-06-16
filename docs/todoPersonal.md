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

- [ ] Fix Socials page — figure out why Instagram posts have been failing and not posting.

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

## To Bo Sorted
- [] Address security threats from cloudflare, github, and supabase
- [] amazon page be able to click the listing sku, name or asin to take you tot he amazon page
- [] amazon page be able to click the listing sku, name, or asin to take you to the kk product page
- [] submit to amazon button should close to push proudct to amazon module
- [] when parent is pushed, pushing child of parent should reuse all entries and settings from the parent during push
- [] amazon page product push, requirements auto load upon product type selection
- [] amaozn page clicking outside of module does not close module
- [] amazon module fix bottom rounded
- [] amazon page drop down feature for parent and kids
- [] amazon page load reuiqrements is not loaded all requiprements for that product type. I click preview amaozn submit and it fails and tells me i need entries that where not preset prior.
- [] amazon page cannot find button and pins product type/category
- [] amazon page ai fill should fill every optional slot and/or add radio or check boxes for which sections to use ai on
- [] on preview amazon submit, missing attributes should be highlighted
- [] amazon product push for title max limit due to amazon update
- [] fix this amaozn issue (This attribute 'Item Highlight' is currently unsupported. Please refer to the tool tip for additional details.)
- [] orders page cancelled orders should not count as unfulled unless its like a partial refund or somthing, like orders that where never shipped shoulnt count toward unfullilled
- [] what happens to my amazon listings if i delete or alter the content of listings from my kk products page?
- [] parcel import support for supplies along with cpi cost for supplies, maybe a supplies page?
- [] do catalog hover images actually work?
- [] combine primary image and catalog image?