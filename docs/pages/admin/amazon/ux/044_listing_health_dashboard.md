# Phase 5E — Listing Health Dashboard

**Prior:** [5D inventory mismatch](043_inventory_mismatch_highlights.md)

Read-only listing health visibility on the Synced tab: open Amazon issues, listing status signals, and recent sync errors per row. No Amazon writes — visibility only.

---

## Scope

| In scope | Out of scope |
|----------|--------------|
| Health fields on `v_amazon_listing_workspace` | Resolve/acknowledge issues from Synced tab |
| Health badge + open issue count in Status column | Full issue drill-down panel (all open issues list) |
| `#amazonHealthFilter` toolbar filter | Amazon SP-API calls from browser |
| `#amazonListingHealthCountLabel` table badge | Issue write-back to Amazon |
| `#amazonListingDetailsModal` (View Details) | Drafts/Issues tab merge (partial overlap OK) |
| CSV health columns | Auto-fix workflows |

---

## Part A — Read model

**Migration:** `20260805_amazon_listing_health_view.sql`

Extends `v_amazon_listing_workspace` (replaces 5D view definition).

### Issue aggregates (from `amazon_listing_issues`)

| Column | Meaning |
|--------|---------|
| `open_issue_count` | Open issues for listing |
| `error_issue_count` | Open `severity = error` |
| `warning_issue_count` | Open `severity = warning` |
| `info_issue_count` | Open `severity = info` |
| `highest_issue_severity` | Max open severity |
| `latest_issue_at` | Newest open issue timestamp |
| `latest_issue_code` | Code on newest open issue |
| `latest_issue_message` | Message on newest open issue |
| `latest_issue_source` | `sync`, `push`, `validation`, etc. |

### Sync error aggregates (from `amazon_sync_errors`)

Matched by **seller SKU or ASIN**, **last 7 days**:

| Column | Meaning |
|--------|---------|
| `recent_sync_error_count` | Count in window |
| `latest_sync_error_message` | Newest message |
| `latest_sync_error_at` | Newest timestamp |

### Derived health

| Column | Meaning |
|--------|---------|
| `listing_health_status` | See rules below |
| `listing_health_reasons` | `text[]` reason chips |
| `has_listing_health_issue` | `listing_health_status <> 'healthy'` |

### `listing_health_status` priority

1. `suppressed` — `listing_status = suppressed`
2. `error` — open error issue OR `listing_status = issue`
3. `sync_error` — recent sync error (7d window)
4. `warning` — open warning OR `listing_status IN (inactive, unknown)`
5. `healthy` — no open issues and `listing_status = active`
6. `unknown` — fallback

### `listing_health_reasons` examples

- Suppressed listing
- Open Amazon error
- Open warning
- Recent sync error
- Unknown listing status
- Inactive listing
- Missing ASIN

---

## Part B — Frontend modules

| File | Role |
|------|------|
| `js/admin/amazon/listingHealth.js` | Badges, filter, row class, CSV helpers |
| `js/admin/amazon/listingDetails.js` | View Details modal hydrate/open |
| `js/admin/amazon/renderListings.js` | Status column health + row tint |
| `js/admin/amazon/listingsQuery.js` | `health` query param |
| `js/admin/amazon/listingsToolbar.js` | `#amazonHealthFilter` |
| `js/admin/amazon/liveListings.js` | Health issue count badge |
| `js/admin/amazon/listingsExport.js` | Health CSV columns |
| `js/admin/amazon/rowActions.js` | View Details → modal |
| `pages/admin/amazon.html` | Filter, badge, modal shell |

### Status column (desktop)

- Listing status badge (Active, Issue, …)
- Health badge (Healthy / Warning / Error / …)
- `N open issues` subline when count > 0

### Row highlights (combine with price/inventory)

| Health | Tint |
|--------|------|
| error / suppressed | Red left border |
| warning / sync_error | Amber left border |
| unknown | Gray left border |

Health tint takes priority over price/inventory on mobile card borders.

---

## Part C — Health filter

**Select:** `#amazonHealthFilter`

| Value | Shows |
|-------|-------|
| *(empty)* | All |
| `healthy` | `listing_health_status = healthy` |
| `warning` | warning |
| `error` | error |
| `suppressed` | suppressed |
| `sync_error` | sync_error |
| `unknown` | unknown |
| `has_issues` | open issues > 0 OR `has_listing_health_issue` |

Client-side filter; composes with search, status, inventory, price/stock compare filters.

---

## Part D — View Details modal

**Modal:** `#amazonListingDetailsModal`

Row action **View Details** opens read-only summary:

- Title, ASIN, SKU, listing status
- Health badge + reason chips
- Price, Amazon qty, KK stock, last synced
- Open issue count + latest issue message/code/source
- Recent sync error count + latest message (7d)
- One-line health summary

---

## Part E — CSV export

Additional columns:

- Health Status
- Open / Error / Warning Issue Count
- Latest Issue Code, Message, Source
- Recent Sync Error Count
- Latest Sync Error

---

## Deploy

```bash
supabase db push   # 20260805_amazon_listing_health_view.sql
```

No new edge function.

---

## Security

- Read-only: SELECT on workspace view only
- No Amazon API from browser
- No service role / LWA tokens in frontend
- No listing PATCH/submit/feeds added in this phase

---

## Known limitations

- Sync errors matched by SKU/ASIN across runs (not scoped to seller account in view)
- 7-day sync error window is fixed (not configurable in UI)
- Only **latest** open issue shown in details (not full issue list)
- Info-severity open issues alone do not change status from `healthy` if listing is active
- Drafts/Issues tab still owns draft workflow issues; Synced tab shows listing-level health only

---

## Verification

1. Row with open error issue shows Error health badge + red tint
2. Row with sync error in last 7d shows Sync Error status (if no higher priority)
3. Health filter narrows results; works with other filters
4. Table badge shows `N health issues` (includes healthy = 0 issues text always visible)
5. View Details modal shows issue + sync error summary
6. CSV includes health columns
7. Price/inventory mismatch columns still render

---

## Next

**Phase 6 — UX polish & analytics** (table settings, activity history, media sync).
