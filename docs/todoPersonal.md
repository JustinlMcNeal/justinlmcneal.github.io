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

- [ ] Add a visual label preview on the orders modal.
  - Show the coupon / label situation for each order.
  - Preview the QR code, CTA, discount, and destination.

- [ ] Create or merge a product purchase page with expenses to get true CPI cost from Baestao XLS imports.

### Shipping, Orders, and Customer Messaging

- [ ] Send customers a text message when their website order ships.

- [ ] Log customer phone numbers in order details.

- [ ] Fix pending status on canceled orders.

- [ ] Update `shipping.html` with more accurate information on how shipping works.

- [ ] Create `returns.html` and link it in the footer.

---

## Priority 1 — Admin Social / Auto-Posting System

### Admin Social Page

- [x] Socials page overhaul.

- [x] Learning for captions.
  - Deep Analysis learnings are now applied to Auto-Queue / Autopilot AI captions as soft guidance.

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

## Completed Milestones

- [x] eBay Line Items Orders profit audit and update
- [x] Line Items Orders outdated import/export button cleanup
- [x] Custom CTA label prints per order
- [x] Public social media page
- [x] Socials page overhaul
- [x] Admin Social caption learning loop
- [x] Remove unavailable slash for out-of-stock / backorder variants

## To be sorted
- [] Universal storage system
- [] KK order address verification
- [] Shipping CTA Scan tracking hub for metrics?
- [] importing hauls for tru cpi cost
- [] product amazon url linked to amazon page auto
- [] 