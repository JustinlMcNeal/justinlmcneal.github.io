# eBay Analytics Page — Implementation Plan
**API**: Analytics API v1.3.2  
**Page**: `pages/admin/ebay-analytics.html`  
**Status**: Planned  

---

## 1. What the Page Does

A standalone admin page (`ebay-analytics.html`) that pulls traffic and conversion data from the eBay Analytics API and displays it per-listing. Completely separate from `analytics.html` (which reads Supabase only). This page calls an external API on load so it intentionally has its own page.

**Key capabilities:**
- Summary cards: total views, total impressions, avg CTR, total transactions
- Per-listing table: name, views, impressions, CTR, transactions, sales conversion rate
- Sortable columns
- Date range selector: Last 7 / 30 / 90 days
- Links through to eBay listing pages for listings with data
- `lastUpdatedDate` shown so admin knows data lag (typically 24–48 hrs)

---

## 2. API — Verified Facts (from eBay docs)

### Endpoint
```
GET https://api.ebay.com/sell/analytics/v1/traffic_report
```

### OAuth Scope Required
```
https://api.ebay.com/oauth/api_scope/sell.analytics.readonly
```

> ⚠️ **CRITICAL**: This scope is NOT currently in `ebayUtils.ts` refresh scope list. See Section 5.

### Query Parameters (all required unless noted)

| Param | Required | Notes |
|-------|----------|-------|
| `dimension` | ✅ | `LISTING` (per-listing data) or `DAY` (per-day aggregate). One per call — cannot mix. |
| `metric` | ✅ | Comma-separated list. See full list below. |
| `filter` | ✅ | Must include `marketplace_ids` and `date_range`. |
| `sort` | Optional | Prepend `-` for descending. Constraints apply. |

### All Valid Metric Values (verified from eBay docs)
```
CLICK_THROUGH_RATE
LISTING_IMPRESSION_SEARCH_RESULTS_PAGE
LISTING_IMPRESSION_STORE
LISTING_IMPRESSION_TOTAL         ← not documented, use TOTAL_IMPRESSION_TOTAL
LISTING_VIEWS_SOURCE_DIRECT
LISTING_VIEWS_SOURCE_OFF_EBAY
LISTING_VIEWS_SOURCE_OTHER_EBAY
LISTING_VIEWS_SOURCE_SEARCH_RESULTS_PAGE
LISTING_VIEWS_SOURCE_STORE
LISTING_VIEWS_TOTAL
SALES_CONVERSION_RATE
TOTAL_IMPRESSION_TOTAL           ← correct name for total impressions
TRANSACTION
```

> ⚠️ **Audit NOTE**: `LISTING_IMPRESSION_TOTAL` is NOT a valid metric name. The correct name is `TOTAL_IMPRESSION_TOTAL`. Using the wrong name returns error 50002.

### Filter Format (URL-encoded in actual request)
```
filter=marketplace_ids:{EBAY_US},date_range:[YYYYMMDD..YYYYMMDD]
```
URL-encoded: `filter=marketplace_ids%3A%7BEBAY_US%7D%2Cdate_range%3A%5BYYYYMMDD..YYYYMMDD%5D`

Optional listing filter (add after date_range, pipe-separated IDs):
```
,listing_ids:{377130200759|123456789}
```

### Date Format
- Default timezone is **America/Los_Angeles** — use `YYYYMMDD` (e.g., `20260101`)
- Dates cannot be in the future (error 50018)
- Start date must be ≤ end date (error 50004)
- Max history: up to **2 years** back (error 50025 if exceeded)
- Max date window per request: limited (error 50026 — exact limit not published, use ≤ 90 days to be safe)

### Sort Constraints
- Prepend `-` for descending: `sort=-CLICK_THROUGH_RATE`
- **`SALES_CONVERSION_RATE` cannot be sorted** (error 50036)
- **`TRANSACTION` can only sort descending** (error 50036 if ascending attempted)

---

## 3. Response Structure

The response is complex — metrics are positional (not named per-record).

```json
{
  "reportType": "TRAFFIC",
  "startDate": "2026-03-22T00:00:00.000Z",
  "endDate": "2026-04-20T23:59:59.000Z",
  "lastUpdatedDate": "2026-04-19T22:00:00.000Z",
  "header": {
    "dimensionKeys": [{ "key": "LISTING", "dataType": "STRING" }],
    "metrics": [
      { "key": "LISTING_VIEWS_TOTAL", "dataType": "NUMBER" },
      { "key": "CLICK_THROUGH_RATE", "dataType": "NUMBER" },
      { "key": "TRANSACTION", "dataType": "NUMBER" }
    ]
  },
  "records": [
    {
      "dimensionValues": [{ "value": "377130200759", "applicable": true }],
      "metricValues": [
        { "value": 142, "applicable": true },
        { "value": 0.032, "applicable": true },
        { "value": 3, "applicable": true }
      ]
    }
  ],
  "dimensionMetadata": [
    {
      "metadataHeader": {
        "key": "LISTING_ID",
        "metadataKeys": [{ "key": "LISTING_TITLE", "dataType": "STRING" }]
      },
      "metadataRecords": [
        {
          "value": { "value": "377130200759", "applicable": true },
          "metadataValues": [{ "value": "Demon Slayer Keychain...", "applicable": true }]
        }
      ]
    }
  ]
}
```

**Key parsing rules:**
- `header.metrics[i].key` = metric name for `records[n].metricValues[i]` — order is positional
- `dimensionValues[0].value` = listing ID (for `dimension=LISTING`)
- `dimensionMetadata[0].metadataRecords` maps listing ID → title via matching `value.value`
- `applicable: false` means the computed value may be invalid (rare edge case — treat as 0)
- `lastUpdatedDate` = always present — show this in the UI so admin knows data age

### Parsing Helper (JavaScript)
```js
function parseTrafficReport(report) {
  const metricKeys = report.header.metrics.map(m => m.key);
  
  // Build listing ID → title map from dimensionMetadata
  const titleMap = new Map();
  const meta = report.dimensionMetadata?.[0];
  if (meta) {
    for (const rec of meta.metadataRecords || []) {
      const listingId = rec.value?.value;
      const title     = rec.metadataValues?.[0]?.value || "";
      if (listingId) titleMap.set(String(listingId), title);
    }
  }
  
  return report.records.map(rec => {
    const listingId = String(rec.dimensionValues[0]?.value || "");
    const row = { listingId, title: titleMap.get(listingId) || "" };
    metricKeys.forEach((key, i) => {
      const mv = rec.metricValues[i];
      row[key] = mv?.applicable !== false ? (mv?.value ?? null) : null;
    });
    return row;
  });
}
```

---

## 4. Implementation Plan

### 4a. Edge Function — Add `get_traffic_report` to `ebay-manage-listing`

Add a new action block to `supabase/functions/ebay-manage-listing/index.ts`:

```ts
const ANALYTICS_API = `${EBAY_API}/sell/analytics/v1`;

// ── GET TRAFFIC REPORT ──────────────────────────────────────
if (action === "get_traffic_report") {
  const { dimension = "LISTING", dateRange, listingIds = [] } = body;
  // dateRange: { start: "20260322", end: "20260421" }
  
  if (!dateRange?.start || !dateRange?.end) {
    return new Response(
      JSON.stringify({ success: false, error: "dateRange.start and dateRange.end required (YYYYMMDD)" }),
      { headers: corsHeaders }
    );
  }
  
  const metrics = [
    "LISTING_VIEWS_TOTAL",
    "LISTING_VIEWS_SOURCE_SEARCH_RESULTS_PAGE",
    "LISTING_VIEWS_SOURCE_DIRECT",
    "LISTING_VIEWS_SOURCE_OFF_EBAY",
    "LISTING_VIEWS_SOURCE_OTHER_EBAY",
    "LISTING_VIEWS_SOURCE_STORE",
    "LISTING_IMPRESSION_SEARCH_RESULTS_PAGE",
    "TOTAL_IMPRESSION_TOTAL",
    "CLICK_THROUGH_RATE",
    "SALES_CONVERSION_RATE",
    "TRANSACTION",
  ].join(",");

  // Build filter string — must URL-encode
  let filterVal = `marketplace_ids:{EBAY_US},date_range:[${dateRange.start}..${dateRange.end}]`;
  if (listingIds.length) {
    filterVal += `,listing_ids:{${listingIds.join("|")}}`;
  }

  const url = new URL(`${ANALYTICS_API}/traffic_report`);
  url.searchParams.set("dimension", dimension);
  url.searchParams.set("metric", metrics);
  // eBay requires these specific encoded characters — use encodeURIComponent on filter value
  url.searchParams.set("filter", filterVal);

  // For LISTING dimension, sort by total views descending
  if (dimension === "LISTING") {
    url.searchParams.set("sort", "-LISTING_VIEWS_TOTAL");
  }

  const resp = await ebayFetch(accessToken, "GET", url.toString());

  if (!resp.ok) {
    return new Response(
      JSON.stringify({ success: false, error: `eBay Analytics error ${resp.status}`, data: resp.data }),
      { headers: corsHeaders }
    );
  }

  return new Response(
    JSON.stringify({ success: true, report: resp.data }),
    { headers: corsHeaders }
  );
}
```

> **Note**: `ebayFetch()` already sets `Authorization: Bearer {token}` and handles non-JSON responses. Use it as-is — no special headers needed for Analytics API.

---

### 4b. Scope Fix in `ebayUtils.ts`

The `getAccessToken` refresh call must include `sell.analytics.readonly`. Add it to the scopes array:

```ts
// In ebayUtils.ts — getAccessToken scopes array
const scopes = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.finances",
  "https://api.ebay.com/oauth/api_scope/sell.account",
  "https://api.ebay.com/oauth/api_scope/sell.account.readonly",
  "https://api.ebay.com/oauth/api_scope/sell.analytics.readonly",  // ← ADD THIS
].join(" ");
```

> ⚠️ **Important**: Adding to the refresh scopes only works if the **original authorization code grant** also included `sell.analytics.readonly`. If the original token was issued without this scope, you must re-run the eBay OAuth connect flow (the "Connect eBay" button in the admin) to get a new refresh token that includes analytics. The refresh token **cannot** gain scopes it was never granted.

**How to check**: Call `GET /sell/analytics/v1/traffic_report` with the current token. If you get a `401` with `"Insufficient permissions"` or scope error, the re-auth flow is needed.

---

### 4c. Frontend — `js/admin/ebayAnalytics/index.js`

```js
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "/js/config/env.js";
import { initAdminNav } from "/js/shared/adminNav.js";
import { initFooter } from "/js/shared/footer.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── callEdge helper (same pattern as ebay-listings) ──────────
async function callEdge(fnName, body) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token || "";
  const url   = `${SUPABASE_URL}/functions/v1/${fnName}`;
  const resp  = await fetch(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body:    JSON.stringify(body),
  });
  return resp.json();
}

// ── Date range helpers ───────────────────────────────────────
function toEbayDate(d) { // Date → YYYYMMDD (Los Angeles default)
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}
function getRange(days) {
  const end   = new Date();
  end.setDate(end.getDate() - 1); // yesterday — today not yet in eBay data
  const start = new Date(end);
  start.setDate(start.getDate() - (days - 1));
  return { start: toEbayDate(start), end: toEbayDate(end) };
}

// ── Data parse ───────────────────────────────────────────────
function parseTrafficReport(report) { /* see Section 3 */ }

// ── Load & render ────────────────────────────────────────────
let currentDays = 30;

async function loadReport() {
  // 1. Load all active eBay listings from DB (for product names / SKUs)
  const { data: products } = await supabase
    .from("products")
    .select("code, name, ebay_listing_id, ebay_status")
    .not("ebay_listing_id", "is", null);

  const listingIds = products.map(p => p.ebay_listing_id).filter(Boolean);
  const productByListingId = new Map(products.map(p => [p.ebay_listing_id, p]));

  // 2. Call Analytics API
  const dateRange = getRange(currentDays);
  const result = await callEdge("ebay-manage-listing", {
    action:    "get_traffic_report",
    dimension: "LISTING",
    dateRange,
    listingIds, // pass our known IDs to avoid 200-listing cap
  });

  if (!result.success) {
    // Show error — check for scope error
    return;
  }

  const rows = parseTrafficReport(result.report);

  // 3. Merge with DB product data (prefer DB name over eBay title)
  const merged = rows.map(row => ({
    ...row,
    product: productByListingId.get(row.listingId),
    displayName: productByListingId.get(row.listingId)?.name || row.title || row.listingId,
    code: productByListingId.get(row.listingId)?.code || "—",
  }));

  // 4. Compute totals for summary cards
  const totalViews  = merged.reduce((s, r) => s + (r.LISTING_VIEWS_TOTAL ?? 0), 0);
  const totalImpr   = merged.reduce((s, r) => s + (r.TOTAL_IMPRESSION_TOTAL ?? 0), 0);
  const totalTxns   = merged.reduce((s, r) => s + (r.TRANSACTION ?? 0), 0);
  const avgCtr      = merged.length
    ? merged.reduce((s, r) => s + (r.CLICK_THROUGH_RATE ?? 0), 0) / merged.length
    : 0;

  renderSummaryCards({ totalViews, totalImpr, totalTxns, avgCtr });
  renderTable(merged);
  renderLastUpdated(result.report.lastUpdatedDate);
}
```

---

### 4d. HTML Page — `pages/admin/ebay-analytics.html`

Structure:
```
Header (page title, date range buttons: 7d / 30d / 90d)
Last Updated banner (shows data lag date from API response)
Summary cards row (4 cards: Views, Impressions, Avg CTR, Transactions)
Table:
  Columns: Product | SKU | Views | Search Impr | Direct | Off-eBay | CTR | Sales | Conv Rate
  Sortable: click column header toggles asc/desc
  eBay link icon on Product name (opens ebay.com/itm/{id})
Footer (initFooter)
```

---

## 5. Scope — Pre-Implementation Checklist

Before building, verify these in order:

- [ ] **1. Add `sell.analytics.readonly` to `ebayUtils.ts` scopes** — deploy
- [ ] **2. Test scope with current token**: call `get_traffic_report` from admin console or curl. If 401 scope error → step 3
- [ ] **3. Re-run eBay OAuth connect** (if needed): go to the eBay connect page, disconnect and reconnect to get a new authorization code grant that includes `sell.analytics.readonly`
- [ ] **4. Confirm `lastUpdatedDate`** is present in response — use it to show data age in UI
- [ ] **5. Verify listing IDs**: use `listingIds` filter to cap to only our listings (avoids 200-listing limit for accounts with many listings)

---

## 6. Known API Constraints (Verified)

| Constraint | Detail |
|-----------|--------|
| Max listings returned (no filter) | 200 |
| Max listing IDs per request | Not published — safe to pass all (~10-20 for KK) |
| Date history | Up to 2 years |
| Max date window | Not published — use ≤ 90 days to avoid error 50026 |
| Data lag | 24–48 hours (varies; `lastUpdatedDate` field is authoritative) |
| `SALES_CONVERSION_RATE` sort | Not sortable (error 50036) |
| `TRANSACTION` sort order | Descending only |
| Dates in future | Not allowed (error 50018) |
| `dimension=DAY` + listing metrics | Cannot get per-listing-per-day breakdown in one call. Need two separate calls (one with `dimension=LISTING`, one with `dimension=DAY`) |
| Scope type | `authorization_code` grant only — no app token (client credentials) for analytics |

---

## 7. Nav + Index Tile

After building the page, add to:

**`page_inserts/admin-nav.html`** — Desktop nav (after eBay link):
```html
<a href="/pages/admin/ebay-analytics.html" class="text-xs text-white/60 hover:text-white transition-colors font-medium">eBay Stats</a>
```

**`page_inserts/admin-nav.html`** — Mobile menu (after eBay Listings):
```html
<a href="/pages/admin/ebay-analytics.html" class="px-3 py-2 text-sm text-white/80 hover:text-white hover:bg-white/10 rounded transition-colors">eBay Analytics</a>
```

**`pages/admin/index.html`** — Dashboard tile (after eBay Listings tile):
```html
<a href="/pages/admin/ebay-analytics.html"
   data-title="eBay Analytics"
   data-kicker="store"
   data-tags="ebay analytics views impressions ctr traffic listings performance"
   class="admin-tile group">
  <div class="admin-tile-icon bg-cyan-100 text-cyan-700">📈</div>
  <div class="admin-tile-badge bg-cyan-100 text-cyan-800">Marketplace</div>
  <div class="admin-tile-title">eBay Analytics</div>
  <div class="admin-tile-desc group-hover:text-pink-500 transition-colors">Views, CTR & sales by listing →</div>
</a>
```

---

## 8. Build Order

1. `ebayUtils.ts` — add `sell.analytics.readonly` scope → deploy
2. Verify scope works (test call) → re-auth if needed
3. `ebay-manage-listing/index.ts` — add `get_traffic_report` action → deploy
4. `js/admin/ebayAnalytics/index.js` — frontend module
5. `pages/admin/ebay-analytics.html` — page shell
6. Nav + index tile additions
7. Commit all
