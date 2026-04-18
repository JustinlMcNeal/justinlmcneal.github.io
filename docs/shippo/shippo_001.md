# Shippo Integration — Karry Kraze

> **API Key**: Stored as Supabase secret `SHIPPO_API_KEY` — **never in code or docs**  
> **API Base**: `https://api.goshippo.com/`  
> **Auth Header**: `Authorization: ShippoToken <key>`  
> **API Version**: `2018-02-08`  
> ⚠️ **Original live key was exposed in this doc — rotated and removed. New key lives only in Supabase secrets.**

---

## Current State (Updated April 18, 2026)

| Area | Status | Details |
|------|--------|--------|
| **Order creation** | ✅ Automated | Stripe webhook → `orders_raw` + `line_items_raw` + `fulfillment_shipments` |
| **Shipping rates** | ⚠️ Hardcoded | Free ($0 over $50), Standard ($8.95), Express ($12.99) — no weight/zone calculation |
| **Label purchase** | ✅ Automated | Admin clicks "Buy Label" in order modal → Shippo creates label → stored in Supabase Storage |
| **Tracking** | ✅ Automated | Shippo webhooks update status automatically (PRE_TRANSIT → TRANSIT → DELIVERED) |
| **Customer notifications** | ✅ Automated | Transactional SMS on shipped + delivered via Twilio (no opt-in required) |
| **Address validation** | ❌ None | Whatever Stripe collects goes straight to DB |
| **Delivery status** | ✅ Automated | Shippo webhooks update `fulfillment_shipments` timestamps + status |
| **Returns** | ❌ None | No return label generation, no returns workflow |

### Previous Fulfillment Workflow (6+ manual steps — REPLACED)

```
1. Admin sees unfulfilled orders on admin/lineItemsOrders.html
2. Downloads "Ship Ready CSV" (shipReadyCsv.js)
3. Imports CSV into Pirate Ship
4. Purchases labels in Pirate Ship ($$$)
5. Exports Pirate Ship tracking data
6. Imports tracking data back via admin UI
7. Manually updates fulfillment status
8. Customer has NO idea what's happening
```

### New Fulfillment Workflow (2 steps)

```
1. Admin opens order modal → clicks "Buy Label" (preset dropdown) → label purchased + stored
2. Clicks "Print Label" → popup shows PNG label → auto-print dialog → Munbyn prints
   → Shippo webhooks handle all tracking updates automatically
   → Customer gets SMS on shipped + delivered
   → Review request auto-triggers on delivery
```

### Database Tables Involved

| Table | Key Columns |
|-------|-------------|
| `orders_raw` | `stripe_checkout_session_id` (PK), `kk_order_id`, name, email, phone, `street_address`, `city`, `state`, `zip`, `country`, `total_weight_g`, `shipping_paid_cents` |
| `line_items_raw` | `stripe_checkout_session_id` (FK), `product_id`, `product_name`, `variant`, `quantity`, `item_weight_g` |
| `fulfillment_shipments` | `stripe_checkout_session_id` (PK), `kk_order_id`, `label_status`, `carrier`, `service`, `tracking_number`, `shipped_at`, `label_cost_cents`, `package_weight_g_final`, `pirate_ship_shipment_id`, `batch_id` |

---

## What Shippo Gives Us

Shippo is a multi-carrier shipping API that replaces the Pirate Ship manual workflow with a fully automated pipeline. One integration, 85+ carriers.

### Core Capabilities

#### 1. Real-Time Rate Shopping

**What it does**: Send package dimensions + weight + addresses → get back live rates from USPS, UPS, FedEx, DHL, and more — sorted by price and speed.

**How it works**:
```
POST /shipments/
{
  address_from: { our warehouse },
  address_to:   { customer address from orders_raw },
  parcels:      [{ length, width, height, weight }]
}
→ Returns array of rates: USPS Priority $7.25 (2 days), USPS Ground $4.80 (5 days), UPS Ground $9.12 (3 days)...
```

**Benefits for Karry Kraze**:
- **Stop leaving money on the table** — current flat $8.95 may be overcharging light items (losing sales) or undercharging heavy items (eating margin)
- **Dynamic checkout rates** — show customers real rates at checkout instead of hardcoded prices
- **Multi-carrier comparison** — automatically pick cheapest option per shipment
- **Shippo USPS discounts** — Shippo provides pre-negotiated USPS Commercial Plus rates (up to 90% off retail), often cheaper than Pirate Ship

#### 2. One-Click Label Purchase

**What it does**: Purchase a shipping label programmatically — returns a PDF/PNG label URL + tracking number instantly.

**How it works**:
```
POST /transactions/
{ rate: "<rate_object_id>", label_file_type: "PDF_4x6" }
→ Returns: { tracking_number, label_url, tracking_url_provider }
```

**Benefits for Karry Kraze**:
- **Eliminate Pirate Ship entirely** — buy labels from the admin dashboard with one click
- **Auto-save tracking number** — writes directly to `fulfillment_shipments`, no CSV import/export
- **Auto-update status** — label purchased → status becomes `label_purchased` automatically
- **PDF label download** — print directly from admin, no third-party app needed
- **Batch labels** — purchase labels for multiple orders at once (Batch API)

#### 3. Automatic Tracking + Webhooks

**What it does**: Once a label is purchased through Shippo, tracking updates flow automatically via webhooks. Also supports registering external tracking numbers.

**Webhook events**:
```
PRE_TRANSIT  → Label created, not yet scanned
TRANSIT      → Package moving (with sub-statuses: out_for_delivery, package_arrived, etc.)
DELIVERED    → Package delivered
RETURNED     → Package being returned to sender
FAILURE      → Delivery issue (lost, damaged, undeliverable)
```

**Benefits for Karry Kraze**:
- **Auto-update `fulfillment_shipments.label_status`** — no more manual status changes
- **Trigger SMS notifications** — "Your order has shipped!" / "Your order was delivered!"
- **Trigger review request SMS** — automatically send review request X days after `DELIVERED`
- **Customer tracking page** — Shippo provides branded tracking pages, or we build our own using the tracking data
- **Shippo branded tracking pages** — `https://track.goshippo.com/tracking/<UserID>/<carrier>/<tracking_number>` with your logo/colors
- **Real-time ETA** — show `eta` and `original_eta` from tracking data on my-orders page

#### 4. Address Validation

**What it does**: Validate shipping addresses before creating labels — catches typos, incomplete addresses, and non-deliverable locations.

**How it works**:
```
POST /addresses/  { ..., validate: true }
→ Returns: { validation_results: { is_valid: true/false, messages: [...] }, is_residential: true/false }
```

**Benefits for Karry Kraze**:
- **Prevent failed deliveries** — catch bad addresses before you pay for a label
- **Avoid surcharges** — carriers charge $15-20+ for address corrections
- **Residential vs commercial** — `is_residential` flag can affect shipping rates
- **Auto-correct addresses** — Shippo returns the corrected/standardized address (USPS format)
- **Pre-checkout validation** — validate address on the checkout review page before sending to Stripe

#### 5. Batch Label Creation

**What it does**: Purchase labels for many orders at once. Submit a batch → Shippo validates all shipments → purchase all labels in one operation → get a merged PDF of all labels.

**How it works**:
```
POST /batches/
{
  default_carrier_account: "<usps_account_id>",
  default_servicelevel_token: "usps_priority",
  batch_shipments: [ { shipment: { address_from, address_to, parcels } }, ... ]
}
→ Returns merged label PDF URLs (100 labels per file)
```

**Benefits for Karry Kraze**:
- **Morning batch workflow** — select all pending orders → "Buy All Labels" → print one PDF → pack and ship
- **Faster fulfillment** — eliminate per-order label buying
- **Error handling** — batch shows which shipments are VALID vs INVALID before purchasing
- **Cost tracking** — each label cost recorded automatically

#### 6. Label Refunds

**What it does**: Void/refund unused shipping labels within the carrier's refund window (typically 30 days for USPS).

**How it works**:
```
POST /refunds/  { transaction: "<transaction_object_id>" }
→ Returns: { status: "QUEUED" | "PENDING" | "SUCCESS" | "ERROR" }
```

**Benefits for Karry Kraze**:
- **Refund unused labels** — if an order is cancelled before shipping, void the label and get your money back
- **Automatic from admin** — "Void Label" button next to each purchased label
- **Track refund status** — Shippo reports back when the carrier processes the refund

#### 7. Orders API

**What it does**: Sync your orders into Shippo's system for a unified fulfillment view.

**Benefits for Karry Kraze**:
- **Optional** — we already have `orders_raw` in Supabase; Shippo orders are mainly useful if you want to use Shippo's dashboard UI for fulfillment
- **Could be useful** for multi-channel (if we sell on Amazon/eBay and want one label-buying interface)
- **Metadata linking** — attach `kk_order_id` to Shippo orders for cross-referencing

#### 8. Returns / Return Labels

**What it does**: Generate pre-paid return shipping labels that you can include in the package or email to the customer.

**How it works**: Create a shipment with `address_from` = customer, `address_to` = your warehouse, then purchase a label.

**Benefits for Karry Kraze**:
- **Easy returns** — customer gets a return label link via email/SMS
- **Professional experience** — "Print your return label" instead of "email us and we'll figure it out"
- **Cost control** — you know the exact cost of the return label upfront
- **Can be on-demand** — only generate when customer requests a return (no wasted labels)

---

## How Shippo Fits Into Karry Kraze

### Integration Points

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CHECKOUT FLOW                                │
│                                                                     │
│  Checkout Page                                                      │
│    ├── Address entered → Shippo: validate address                   │
│    ├── Valid? → Shippo: get rates (real-time)                       │
│    ├── Customer picks shipping speed                                │
│    └── Stripe checkout with real rate                                │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                        FULFILLMENT FLOW                             │
│                                                                     │
│  Admin Dashboard                                                    │
│    ├── Order arrives (Stripe webhook)                               │
│    ├── Admin clicks "Buy Label" or "Buy All Labels"                 │
│    │     └── Shippo: create shipment + purchase transaction         │
│    │         → tracking_number + label_url saved to DB              │
│    │         → status: pending → label_purchased                    │
│    ├── Admin prints label PDF, packs & ships                        │
│    └── Carrier scans package                                        │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                        TRACKING FLOW                                │
│                                                                     │
│  Automatic (Shippo Webhooks)                                        │
│    ├── PRE_TRANSIT → status: label_purchased                        │
│    ├── TRANSIT     → status: shipped + SMS "Your order shipped!"    │
│    ├── DELIVERED   → status: delivered + SMS review request trigger  │
│    ├── RETURNED    → status: returned + admin alert                 │
│    └── FAILURE     → admin alert + customer notification            │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                        CUSTOMER EXPERIENCE                          │
│                                                                     │
│  My Orders Page                                                     │
│    ├── Show tracking status (PRE_TRANSIT/TRANSIT/DELIVERED)         │
│    ├── Show ETA from Shippo tracking data                           │
│    ├── "Track Package" link → Shippo branded tracking page          │
│    └── Tracking history timeline                                    │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Benefits Summary

| Benefit | Impact |
|---------|--------|
| **Eliminate Pirate Ship** | No more CSV export → import → export → import dance |
| **USPS discounts** | Shippo's pre-negotiated Commercial Plus rates — often cheaper than Pirate Ship |
| **Real-time rates at checkout** | Accurate pricing instead of flat $8.95; better margins on light items, fair prices on heavy ones |
| **Automated tracking** | Webhooks update status automatically — no manual label_status changes |
| **Customer notifications** | "Your order shipped!" + "Your order was delivered!" via existing SMS system |
| **Review request automation** | `DELIVERED` webhook → trigger review request SMS (existing system, just needs the trigger) |
| **Address validation** | Catch bad addresses before paying for labels — avoid $15+ correction surcharges |
| **Batch labels** | Buy all labels at once, print merged PDF — 5-minute morning routine |
| **Return labels** | Generate return labels on demand — professional returns experience |
| **One dashboard** | Buy labels, track packages, void labels, all from admin/lineItemsOrders |
| **Multi-carrier** | Compare USPS vs UPS vs FedEx per order — always pick cheapest |
| **Tracking page** | Branded tracking page for customers or use data to build our own on my-orders |

### Cost Comparison

| | Pirate Ship (current) | Shippo |
|---|---|---|
| **Monthly fee** | Free | Free (pay per label) |
| **Label markup** | None | None (pay carrier rate) |
| **USPS rates** | Commercial rates | Commercial Plus rates (often cheaper) |
| **Tracking** | Manual import | Automatic via webhooks |
| **Address validation** | None | Free for US addresses |
| **API access** | None (manual only) | Full REST API |
| **Batch labels** | Yes (manual) | Yes (API + admin UI) |
| **Return labels** | Manual | API-generated |
| **Tracking pages** | None | Branded pages included |

---

## Scope Decisions

| Decision | Choice | Notes |
|----------|--------|-------|
| **International shipping** | ❌ US-only | Not needed — all customers are domestic |
| **Insurance / declared value** | ❌ Skip | Not worth the cost at current volume |
| **Partial shipments** | ❌ 1 order = 1 package | Splitting orders into multiple shipments adds cost + complexity. Keep it simple: one label per order |
| **Email notifications** | ⏳ Later | Currently using Twilio for SMS. Could add SendGrid for email ship/delivery notifications in the future |
| **Carrier accounts** | USPS only (for now) | Small, lightweight items shipped infrequently. Shippo provides Commercial Plus USPS rates automatically — no setup needed |

---

## Test Mode

Shippo provides test API tokens (`shippo_test_...`) for development:

| | Test Mode | Live Mode |
|---|---|---|
| **Token prefix** | `shippo_test_` | `shippo_live_` |
| **Labels generated** | Fake (sample PDFs) | Real (chargeable) |
| **Tracking numbers** | Fake (no carrier scans) | Real |
| **Rates returned** | Sample rates | Live carrier rates |
| **Cost** | $0 | Carrier rate per label |

### When to Use Test Mode

- **All development**: Build and test every edge function + admin UI using the test token
- **End-to-end testing**: Verify the full flow (create shipment → get rates → buy label → webhook → status update) without spending money
- **Webhook testing**: Test mode webhooks work — Shippo sends fake tracking events
- **Go-live switch**: Change the Supabase secret from test to live token when ready

```bash
# Development (Phase 0)
supabase secrets set SHIPPO_API_KEY=shippo_test_xxxxx

# Production (after Phase 1 verified)
supabase secrets set SHIPPO_API_KEY=shippo_live_<rotated_key>
```

---

## Implementation Phases

### Phase 0: Foundation (Before Any Code)

**Goal**: Rotate exposed key, set up test environment, prepare DB, add safety guards.

| Task | Details |
|------|---------|
| Rotate live API key | Go to Shippo dashboard → generate new live key → old key is now invalid |
| Store new key as Supabase secret | `supabase secrets set SHIPPO_API_KEY=shippo_live_<new_key>` |
| Set test key for development | `supabase secrets set SHIPPO_API_KEY=shippo_test_xxxxx` |
| Run DB migration | Add all Phase 1+2 columns to `fulfillment_shipments` (see DB Changes table) |
| Create `package_presets` table | With the 3 initial presets (Small Flat, Medium Flat, Standard Box) |
| Create `shippo_webhook_events` table | For webhook event logging / debugging |
| Verify test webhook flow | Register a test webhook URL → confirm events arrive → confirm edge function processes them |

#### Idempotency Protection (Critical)

The biggest execution risk is **double-purchasing labels** from double-clicks, retries, batch reruns, or state mismatches.

Guards to build into Phase 0:

| Guard | Implementation |
|-------|----------------|
| **DB check before purchase** | `shippo-create-label` checks: if `fulfillment_shipments.shippo_transaction_id` already exists AND `label_status != 'voided'` → refuse purchase, return existing label |
| **Disable button while in-flight** | "Buy Label" button → disabled + spinner while API call is running. Re-enable on success/error |
| **Batch skip** | `shippo-batch-labels` skips any row that already has a `shippo_transaction_id` (unless voided). Returns skip count in response |
| **Unique constraint** | Add `UNIQUE` constraint on `fulfillment_shipments.shippo_transaction_id` as a final safety net |

#### Webhook Idempotency

Shippo may resend the same tracking event (retries, duplicate deliveries). The `shippo-webhook` edge function must be safe to process the same event more than once:

- **Dedupe by state**: Only update `fulfillment_shipments` if the new status is meaningfully newer (e.g. don't overwrite `delivered` with `in_transit`)
- **Ordered status progression**: `pending` → `label_purchased` → `shipped` → `delivered`. Never go backwards. Use a status rank check before updating
- **Timestamp guard**: Only update `last_tracking_sync_at` if the incoming event timestamp is newer than the stored one
- **Always log**: Even duplicate/ignored events get written to `shippo_webhook_events` with `status = 'ignored'` so we can see what Shippo sent

### Phase 1: Core Label Buying (Replace Pirate Ship)

**Goal**: Admin can buy a single label and print it from the dashboard.

| Task | Details |
|------|---------|
| Create `shippo-create-label` edge function | Takes order ID + package preset → builds shipment → gets rates → purchases cheapest USPS label → returns tracking + label URL |
| Add "Buy Label" button to admin order modal | One click → calls edge function → saves tracking_number + label_url + label_cost to `fulfillment_shipments` |
| Save to Supabase Storage | Download label PDF from Shippo → upload to `labels/{kk_order_id}.pdf` → save permanent URL in `label_url` |
| Add "Print Label" button | Opens label PDF → browser print dialog → Munbyn prints |
| Add "Reprint Label" button | For already-purchased labels — re-opens the stored label URL |
| Add "Void Label" button | Calls Shippo refund API — **full refund** if label unused. USPS allows void within 30 days if not scanned |
| Add `shippo_transaction_id` column | To `fulfillment_shipments` for void/refund lookups |
| Package preset dropdown | Select package size when buying label (or accept default) |

#### Phase 1 Success Criteria ✅ — COMPLETED (commits 278f5c6 → c6f0f23)

- [x] Admin can buy one label from the order modal (test mode) — tested $5.55 USPS Ground Advantage
- [x] Tracking number saves to `fulfillment_shipments` automatically
- [x] Label PNG downloads to Supabase Storage (`labels` bucket, private + RLS)
- [x] Label prints from admin via Munbyn (popup window + `@page { size: 4in 6in }` + auto-print)
- [x] Void label works and returns money (tested: Shippo refund API → status PENDING)
- [x] Double-click does NOT create duplicate labels (idempotency: returns `duplicate: true`)
- [x] Switch to live key → done (April 18, 2026)
- [ ] First real package moves from label purchase → carrier scan (awaiting first live shipment)

#### Phase 1 Implementation Details

| Component | File | Notes |
|-----------|------|-------|
| Buy label edge function | `supabase/functions/shippo-create-label/index.ts` | Order → shipment → rates → cheapest USPS → PNG label → Storage → DB |
| Void label edge function | `supabase/functions/shippo-void-label/index.ts` | Shippo refund API → mark voided → cleanup |
| Admin API functions | `js/admin/lineItemsOrders/api.js` | `buyShippingLabel()`, `voidShippingLabel()`, `getSignedLabelUrl()`, `fetchPackagePresets()` |
| Admin UI | `js/admin/lineItemsOrders/index.js` | Buy/Print/Reprint/Void buttons, preset dropdown, popup print with `@page` CSS |
| Label format | PNG (not PDF) | PDF had rendering/sizing issues in Edge; PNG prints perfectly on Munbyn 4x6 thermal |
| Storage | `labels` bucket (private) | RLS policy `admin_read_labels` for authenticated SELECT; signed URLs for access |

### Phase 2: Automatic Tracking + SMS — COMPLETED (commit fdb3ddf → 8b51bac)

**Goal**: Tracking status updates automatically — no manual status changes, customers get notified.

| Task | Status | Details |
|------|--------|---------|
| Create `shippo-webhook` edge function | ✅ | Receives `track_updated` → logs to `shippo_webhook_events` → updates `fulfillment_shipments` |
| Register webhook with Shippo | ✅ | Webhook ID `de7121788122467b8962fbd326d89bf4`, event `track_updated`, `verify_jwt = false` |
| Map Shippo statuses | ✅ | `PRE_TRANSIT` → label_purchased, `TRANSIT` → shipped, `DELIVERED` → delivered, `RETURNED` → returned |
| Update timestamps | ✅ | `in_transit_at`, `delivered_at`, `returned_at`, `last_tracking_sync_at`, `estimated_delivery` |
| Trigger SMS on ship | ✅ | Transactional SMS via `send-sms` → "Your order has shipped!" + USPS tracking link |
| Trigger SMS on delivery | ✅ | "Your order has been delivered!" + review link |
| Trigger review request | ✅ | Calls `send-review-request` edge function on DELIVERED status |
| Show tracking on my-orders | ✅ | Status badges on order cards + tracking section in detail view with "Track Package" link |
| Pirate Ship cleanup script | ❌ | Not yet done — can do as one-time script when ready |

#### Phase 2 Implementation Details

| Component | File | Notes |
|-----------|------|-------|
| Webhook edge function | `supabase/functions/shippo-webhook/index.ts` | Logs all events, updates shipments, sends SMS, triggers review requests |
| Webhook URL | `https://yxdzvzscufkvewecvagq.supabase.co/functions/v1/shippo-webhook` | Registered via Shippo API |
| SMS consent | **Not required** | Shipping SMS is transactional under TCPA — sent to all customers with phone numbers |
| SMS content (shipped) | `"Hey {name}! 🎉 Your Karry Kraze order {id} has shipped! Tracking: {usps_link}"` | |
| SMS content (delivered) | `"Hi {name}! 📦 Your order {id} has been delivered! Leave a review: {link}"` | |
| Lookup-orders update | `supabase/functions/lookup-orders/index.ts` | Now returns `shipment` object with status, carrier, tracking, dates |
| My-orders frontend | `js/my-orders/index.js` + `pages/my-orders.html` | Status badges + tracking detail section |
| Admin fulfillment UI | `js/admin/lineItemsOrders/index.js` | Shows shipped date, ETA, delivered date when available |

### Phase 3: Batch Labels + Monitoring

**Goal**: Buy labels for multiple orders at once; add shipping health visibility.

| Task | Details |
|------|---------|
| Create `shippo-batch-labels` edge function | Takes array of order IDs → batch label purchase via Shippo Batch API → returns merged PDF |
| Add checkbox column to orders table | For bulk selection |
| Add "Buy & Print Selected" button | Above the table — processes selected pending orders, opens merged PDF for printing |
| Add "Ready to Ship" filter preset | Quick filter: pending + in-stock (excludes backorder/MTO awaiting stock) |
| Shipping Health dashboard widget | Stale labels count, failed labels, void window warnings, monthly spend (see Monitoring section) |

### Phase 4: Smart Checkout Rates + Returns

**Goal**: Replace hardcoded shipping prices with real carrier rates; add return labels.

| Task | Details |
|------|---------|
| Create `shippo-get-rates` edge function | Takes cart items + shipping address → calculates weight → calls Shippo rates API → returns options |
| Update checkout page | Call rates API after address entry → show real carrier options with prices and ETAs |
| Update `create-checkout-session` | Pass selected Shippo rate ID in metadata; use real price for Stripe shipping line |
| Keep free shipping logic | If subtotal ≥ $50 or free_shipping coupon → still show $0 but pick cheapest carrier internally |
| Validate address on label purchase | Before buying label, validate address via Shippo → show warnings if invalid |
| Optional: validate at checkout | Call Shippo address validation when customer enters address (adds friction — test first) |
| Create `shippo-return-label` edge function | Generate return label: customer address → our warehouse |
| Add "Generate Return Label" to admin | Button in order modal → creates return label → SMS link to customer |

---

## Edge Functions

| Function | Method | Purpose | Phase | Status |
|----------|--------|---------|-------|--------|
| `shippo-create-label` | POST | Buy a shipping label for one order | 1 | ✅ Deployed |
| `shippo-void-label` | POST | Void/refund an unused label | 1 | ✅ Deployed |
| `shippo-webhook` | POST | Receive tracking updates from Shippo | 2 | ✅ Deployed |
| `shippo-batch-labels` | POST | Buy labels for multiple orders at once | 3 | ❌ Not started |
| `shippo-get-rates` | POST | Get live shipping rates for checkout | 4 | ❌ Not started |
| `shippo-return-label` | POST | Generate a return label | 4 | ❌ Not started |

## Database Changes Needed

| Change | Table | Details | Phase |
|--------|-------|---------|-------|
| Add `shippo_transaction_id` | `fulfillment_shipments` | Shippo transaction ID for void/refund (UNIQUE constraint) | 0 |
| Add `shippo_rate_id` | `fulfillment_shipments` | Shippo rate ID used for label purchase | 0 |
| Add `label_url` | `fulfillment_shipments` | Supabase Storage URL for label PDF (verify if exists) | 0 |
| Add `tracking_url` | `fulfillment_shipments` | Carrier tracking page URL | 0 |
| Add `label_purchased_at` | `fulfillment_shipments` | Timestamp when label was bought | 0 |
| Add `in_transit_at` | `fulfillment_shipments` | Timestamp of first carrier scan | 0 |
| Add `delivered_at` | `fulfillment_shipments` | Timestamp of delivery | 0 |
| Add `returned_at` | `fulfillment_shipments` | Timestamp if package returned | 0 |
| Add `last_tracking_sync_at` | `fulfillment_shipments` | Last webhook update timestamp | 0 |
| Add `estimated_delivery` | `fulfillment_shipments` | ETA from Shippo tracking | 0 |
| Create `package_presets` | (new table) | Editable package dimensions for label purchase | 0 |
| Create `shippo_webhook_events` | (new table) | Webhook event log for debugging | 0 |
| Add `shippo_address_validation` | `orders_raw` | JSON result of address validation | 4 |

---

## Sender Address (Warehouse)

The `address_from` for all shipments. This should be stored in `site_settings` or as a Supabase secret, not hardcoded.

```json
{
  "name": "Karry Kraze",
  "street1": "1283 Lynx Crt",
  "city": "Hampton",
  "state": "GA",
  "zip": "30228",
  "country": "US",
  "phone": "4704350296",
  "email": "support@karrykraze.com"
}
```

> Stored in `site_settings` table so it can be updated from admin without code changes.

---

## Package Presets

Stored in a `package_presets` table — admin can add/remove/edit from an admin panel.

| Name | Length | Width | Height | Type | Use Case |
|------|--------|-------|--------|------|----------|
| Small Flat | 6" | 8" | — | Flat / padded mailer | Jewelry, small accessories |
| Medium Flat | 14" | 10" | — | Flat / padded mailer | Headwear, bags |
| Standard Box | 15" | 12" | 10" | Box | Plushies, lego sets, multi-item orders |

### `package_presets` Table

```sql
CREATE TABLE package_presets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  length_in NUMERIC NOT NULL,
  width_in NUMERIC NOT NULL,
  height_in NUMERIC,            -- NULL for flat/mailer packages
  weight_oz NUMERIC,            -- optional default tare weight
  is_default BOOLEAN DEFAULT false,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### `shippo_webhook_events` Table

```sql
CREATE TABLE shippo_webhook_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_type TEXT NOT NULL,         -- 'track_updated', etc.
  tracking_number TEXT,
  carrier TEXT,
  payload_json JSONB NOT NULL,      -- full Shippo webhook payload
  processed_at TIMESTAMPTZ DEFAULT now(),
  status TEXT DEFAULT 'processed',  -- 'processed', 'error', 'ignored'
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

> This table saves every webhook event Shippo sends. Invaluable for debugging tracking issues, replaying missed events, and verifying webhook health.

### Admin UI

- **Admin page**: `admin/packages.html` (or a section in settings)
- **CRUD**: Add / edit / delete package presets
- **Default preset**: One preset marked `is_default` — auto-selected when buying a label
- **Label purchase flow**: Admin picks a preset from a dropdown when buying a label (or accepts the default). Dimensions sent to Shippo with the shipment

### Shippo Integration

When creating a shipment, the selected preset maps to Shippo's `parcel` object:

```json
{
  "length": "15",
  "width": "12",
  "height": "10",
  "distance_unit": "in",
  "weight": "<order total_weight_g converted to oz>",
  "mass_unit": "oz"
}
```

For flat packages (height = null), set height to `"1"` (Shippo requires all three dimensions).

---

## Security Notes

- **API key storage**: Stored as Supabase secret (`SHIPPO_API_KEY`), never in client-side code
- **Webhook verification**: Shippo webhooks should be verified (check request origin + validate payload)
- **Edge function auth**: `shippo-webhook` needs `verify_jwt = false` (Shippo sends unsigned POSTs); all admin-facing functions use service role auth
- **Label URLs**: Shippo label URLs are signed S3 URLs that expire after ~24 hours. The label itself is NOT deleted — you can always call `GET /transactions/{id}` to get a fresh URL. But as a backup and for fast reprinting, we download and store labels in **Supabase Storage** (`labels` bucket, **private**) immediately after purchase
- **Label storage strategy**: On label purchase → download PDF from `label_url` → upload to Supabase Storage as `labels/{kk_order_id}.pdf` → save the path in `fulfillment_shipments.label_url`. Access via **signed URLs** (not public) since labels contain names and addresses. Admin UI generates a short-lived signed URL when "Print Label" or "Reprint Label" is clicked
- **PII handling**: Shipping addresses are already in `orders_raw`; Shippo receives the same data for label creation — no new PII exposure

---

## Key API Endpoints Reference

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/addresses/` | POST | Create + validate address |
| `/shipments/` | POST | Create shipment → returns rates |
| `/transactions/` | POST | Purchase label from a rate |
| `/tracks/` | POST | Register tracking number for webhook updates |
| `/tracks/{carrier}/{tracking_number}` | GET | Get current tracking status |
| `/batches/` | POST | Create batch label purchase |
| `/batches/{id}/purchase` | POST | Purchase all labels in batch |
| `/refunds/` | POST | Void/refund a label |
| `/orders/` | POST/GET | Sync orders (optional) |

---

## Label Printing (Munbyn RW403B)

> **Printer**: Munbyn RW403B — 4x6 thermal label printer  
> **Connection**: Bluetooth (paired to PC) — no USB cable needed  
> **Also connected to**: Phone (for on-the-go printing)  
> **No cloud API**: Munbyn is hardware-only — printing goes through OS print system (browser → Windows → Bluetooth → printer)

### Why Not Auto-Print?

Auto-printing (label purchased → automatically sent to printer) isn't practical:
- **Backorders / MTO items** — can't ship what you don't have yet; printing a label prematurely wastes labels and creates confusion
- **Browser security** — browsers require user interaction to trigger print (no silent `window.print()`)
- **Would need a local print agent** — a background app that polls for new labels and sends to printer. Overkill for current volume and adds complexity

### Single Label Print (Implemented ✅)

```
Admin clicks "Buy Label" on an order
  → Shippo returns PNG label (4x6)
  → PNG stored in Supabase Storage (labels bucket, private)
  → Admin clicks "Print Label"
  → Popup window opens immediately (avoids popup blocker)
  → Fetches signed URL → renders PNG with @page { size: 4in 6in } CSS
  → Auto-triggers window.print() after 400ms
  → Munbyn RW403B pre-selected (set as Windows default)
  → One Enter press → label prints
```

**Implementation**: Popup opens synchronously on click (before async fetch). Signed URL fetched → HTML page with `<img>` + `@media print` CSS for 4x6 sizing + `onload="setTimeout(window.print, 400)"`. PNG format chosen over PDF because Edge had rendering/sizing issues with PDF in iframes and popup windows.

**Key learnings**:
- `window.open()` must be called synchronously (not after `await`) or Edge blocks it as a popup
- PDF labels in Edge: iframe couldn't print, blob URLs rendered blank in print preview, raw PDF opened but clipped in print
- PNG labels: render perfectly as `<img>` with `@page { size: 4in 6in }` CSS
- Munbyn must be set as Windows default printer (uncheck "Let Windows manage my default printer" first)

### Bulk Print (Recommended Daily Workflow)

```
Morning routine:
  1. Open admin/lineItemsOrders
  2. Filter: status = "pending" AND not backorder/MTO (or MTO items that have arrived)
  3. Select all ready-to-ship orders (checkboxes)
  4. Click "Buy & Print All Labels"
     → Shippo Batch API creates all labels at once
     → Returns merged PDF (up to 100 labels in one file)
  5. Browser opens merged PDF → one print dialog → Munbyn prints all labels back-to-back
  6. Pack orders, stick labels, drop off at USPS
```

**Shippo Batch API returns merged PDFs**: `label_url` is an array of URLs, each containing up to 100 4x6 labels per file. One print job = all labels printed sequentially on the Munbyn.

### Admin UI Changes for Printing

| Feature | Details |
|---------|---------|
| **"Print Label" button** | In order modal, next to the label_url — opens PDF + triggers print |
| **Checkbox column** | Add checkboxes to the orders table for bulk selection |
| **"Buy & Print Selected" button** | Above the table — processes selected pending orders via Batch API, then opens merged PDF for printing |
| **"Reprint Label" button** | For already-purchased labels — re-opens the label_url for reprinting |
| **Status filter presets** | Quick filter: "Ready to Ship" = pending + in-stock items (excludes backorder/MTO awaiting stock) |
| **Print preview** | Optional: show label thumbnail in the order modal before printing |

### Munbyn Setup (Done ✅)

- **Bluetooth paired to PC** — shows as a Windows printer in browser print dialogs
- **Chrome print settings**: Destination: Munbyn RW403B, Layout: Portrait, Paper size: 4"x6", Margins: None, Scale: 100%
- **Save Chrome settings**: Once configured, Chrome remembers the last printer + settings per site
- **Shippo label format**: Request `PDF_4x6` in all transaction/batch calls — pixel-perfect match for the Munbyn
- **Phone backup**: Munbyn also connected to phone — can download label PDFs and print from phone if away from PC

### MTO / Backorder Handling

Orders with MTO or backordered items should be excluded from bulk label buying until stock arrives:

```
Bulk label filter logic:
  - fulfillment_shipments.label_status = 'pending'
  - AND (product.shipping_status IS NULL              ← regular in-stock items
         OR product.shipping_status = 'mto'
            AND admin has marked "MTO received")      ← manual flag when MTO item arrives
```

**Option A**: Add `mto_received_at` timestamp to `fulfillment_shipments` — admin clicks "Item Received" when the MTO product arrives → order becomes eligible for bulk label buying.

**Option B**: Simpler — admin just doesn't select MTO orders in the bulk checkbox list until they're ready. No DB change needed.

> **Recommendation**: Start with Option B (manual selection). Add Option A later if MTO volume increases.

---

## Error Handling Strategy

Recommendation: **fail gracefully, show clear errors, never block the admin UI**.

| Scenario | Handling |
|----------|----------|
| **Shippo API down** (500/timeout) | Show red toast: "Shippo is temporarily unavailable — try again in a few minutes." Don't retry automatically — admin clicks "Buy Label" again when ready |
| **Invalid address** (Shippo rejects) | Show the specific Shippo error (e.g. "ZIP code does not match city/state"). Let admin edit the address in the order modal and retry |
| **Rate fetch fails** | **Checkout (Phase 4)**: Fall back to hardcoded rates ($8.95 / $12.99) so customers can still check out. Log the error. **Admin label purchase (Phase 1)**: Do NOT fall back — show error and stop. Admin should never buy a label based on fake rates |
| **Batch label — partial failure** | Some labels succeed, some fail. Show summary: "8/10 labels purchased. 2 failed:" + list failed orders with reasons. Admin fixes and retries the failed ones |
| **Webhook delivery fails** | Shippo auto-retries webhooks for up to 3 days. If our edge function errors, it returns 500 → Shippo retries. Log the failure for debugging |
| **Void fails** (label already scanned) | Show toast: "Cannot void — label has already been scanned by carrier." |
| **Label PDF download fails** | Store Shippo `transaction_id` so we can always re-fetch the label URL via `GET /transactions/{id}` |

> **Pattern**: Every edge function returns `{ success: true/false, error?: string, data?: {...} }`. Admin UI shows green toast on success, red toast with the error message on failure.

---

## Monitoring

Lightweight monitoring — no external tools needed, just smart queries and alerts.

| Check | How | Frequency |
|-------|-----|-----------|
| **Stale labels** | Query: labels purchased > 3 days ago but no carrier scan (`label_status = 'label_purchased'` and `shipped_at IS NULL`) | Daily (admin dashboard widget) |
| **Webhook health** | Log every webhook call. If no webhooks received in 48 hours during active shipping, something is wrong | Passive (check logs if tracking stops updating) |
| **Failed labels** | Count of `label_status = 'error'` in last 7 days | Admin dashboard widget |
| **Void window warning** | Labels purchased > 25 days ago with no scan — approaching USPS 30-day void deadline | Daily (highlight in admin) |
| **Spend tracking** | Sum of `label_cost_cents` this month vs last month | Admin dashboard widget |

> **Implementation**: Add a "Shipping Health" card to the admin dashboard showing stale labels count, failed labels, and monthly spend. No cron jobs needed — just live queries.

---

## Pirate Ship Transition

**Decision**: Clean break — all Pirate Ship orders are already shipped.

However, some existing orders have tracking numbers from Pirate Ship that haven't been updated to `delivered` in the database. Two options:

| Option | Effort | Benefit |
|--------|--------|---------|
| **A: One-time tracking sync** | Write a migration script that takes all `fulfillment_shipments` with `pirate_ship_shipment_id` and `label_status != 'delivered'`, checks USPS tracking via Shippo's `GET /tracks/usps/{tracking_number}`, and updates `label_status` to `delivered` + sets `delivered_at` | Clean data — all old orders show correct final status |
| **B: Leave as-is** | Do nothing — old orders stay with whatever status they have now | Zero effort, old orders just have stale status |

> **Recommendation**: Option A is worth doing as a one-time script. It's a few API calls and cleans up the data. Can do it once right after Phase 2 webhook is live, since we'll have the tracking lookup code already built.

---

## Open Questions

*All resolved.* ✅