# API Setup To-Do List

---

## Amazon Selling Partner API (SP-API)

### Registration (In Progress)
- [x] Sign up as developer on Seller Central
- [x] Submit Solution Provider Profile (roles, use cases, security controls)
- [ ] Wait for developer registration review (1–3 weeks)
- [ ] Respond to any follow-up questions from Amazon (check email + Seller Central cases)

### Identity Verification
- [ ] Complete identity verification (click "Get Started" in Developer Central)
  - Need: Business registration info + identity document
  - Takes ~20 minutes to submit, days to review

### After Approval
- [ ] Create a **production app client** in Developer Central
- [ ] Note down: Client ID, Client Secret (LWA credentials)
- [ ] Set up IAM role in AWS → get AWS Access Key + Secret Key
- [ ] Self-authorize the app for your own seller account (generate refresh token)

### Build Integration
- [ ] Install `amazon-sp-api` npm package (or use raw fetch + `aws4` for signing)
- [ ] Build SP-API client with LWA token exchange + AWS Sig v4 signing
- [ ] **Orders API** — auto-import Amazon orders into admin dashboard (replace CSV import)
- [ ] **Product Pricing API** — monitor competitor prices + Buy Box status
- [ ] **Catalog Items API** — sync product details, BSR, categories
- [ ] **Listings Items API** — update/optimize listings programmatically
- [ ] **Reports API** — pull financial/settlement data for tax prep
- [ ] **Notifications API** — subscribe to `ANY_OFFER_CHANGED` for real-time price alerts
- [ ] (Optional) Build auto-repricer logic using pricing notifications

### Roles Selected
- Product Listing
- Pricing
- Finance and Accounting
- Inventory and Order Tracking
- Selling Partner Insights

### Resources
- SP-API Docs: https://developer-docs.amazon.com/sp-api/
- API Models: https://github.com/amzn/selling-partner-api-models
- Node SDK: https://www.npmjs.com/package/amazon-sp-api

---

## Instagram Comment → Auto-DM Coupon

### Meta App Setup
- [ ] Go to Meta Developer Dashboard → your app → Permissions
- [ ] Add permission: `instagram_manage_comments`
- [ ] Add permission: `instagram_manage_messages`
- [ ] Add yourself as a test user (if not already admin)
- [ ] Verify Meta Business account (if not already done)

### Update OAuth Scope
- [ ] Update `js/admin/social/index.js` line 653 — add new scopes:
  ```
  instagram_manage_comments,instagram_manage_messages
  ```
- [ ] Re-authenticate Instagram in admin panel to get new token with expanded permissions

### Build Edge Functions
- [ ] **`instagram-comment-webhook`** — receives webhook when someone comments on your posts
  - Detect keyword (e.g., "COUPON") in comment text
  - Look up commenter's Instagram user ID
  - Generate unique coupon code → save to `promotions` table
  - Call DM function to send coupon
- [ ] **`instagram-dm`** — sends a DM to a user via Instagram Messaging API
  - Uses `graph.facebook.com/v18.0/me/messages`
  - Sends coupon code + message to the commenter
- [ ] **Webhook subscription** — register your webhook URL with Meta for `comments` field on your IG account

### Database
- [ ] Add tracking table or column for comment-triggered coupons (who received, when, used?)
- [ ] Decide coupon rules: % off, flat amount, one-time use, expiry

### Test in Development Mode
- [ ] Test end-to-end: comment on your own post → webhook fires → DM received with coupon
- [ ] Test coupon works at checkout (your existing promo system)
- [ ] Record screencast of the full flow (1–2 min video)

### Submit Meta App Review
- [ ] Write description for `instagram_manage_comments` — explain keyword detection use case
- [ ] Write description for `instagram_manage_messages` — explain auto-DM coupon delivery
- [ ] Attach screencast video
- [ ] Confirm privacy policy URL: https://karrykraze.com/pages/privacy.html
- [ ] Submit for review (1–4 weeks for approval)

### After Approval
- [ ] Switch app from Development Mode to Live Mode
- [ ] Test with a real customer / friend's account
- [ ] Announce on Instagram: "Comment COUPON on our latest post for a discount!"

---

## Notes
- Amazon review is currently pending as of Feb 24, 2026
- Instagram features can be built and tested in dev mode before Meta review
- Brand Registry (requires trademark, ~$250+) unlocks Brand Analytics API — consider later
- IP Accelerator ($600–1,000) gives instant Brand Registry while trademark is pending
