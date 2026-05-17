# CTA Label Phase 2F - Workspace Labels Tab

## What Was Added

Added a read-only Labels tab to the admin line items order workspace.

The tab appears in this order:

1. Overview
2. Financials
3. Fulfillment
4. Labels
5. IDs

## Files Changed

- `js/admin/lineItemsOrders/api.js`
- `js/admin/lineItemsOrders/workspace.js`
- `js/admin/lineItemsOrders/workspaceLabels.js`
- `docs/audit/implementation/ctaLabel/007_phase2f_workspace_labels_tab.md`

## Label History Fetching

Added `fetchCtaLabelHistory(sessionId)` in `api.js`.

The helper reads existing rows from:

- `cta_label_prints`
- `cta_label_links`
- `cta_label_scans`

Each table is queried by `session_id`. The helper returns normalized arrays plus JS-built lookup objects for scan counts, latest scans, and links grouped by print ID. No database views, writes, or redirects were added.

Follow-up RLS fix: live verification found `cta_label_prints` had rows but no authenticated SELECT policy, so authenticated admins could see links/scans but not print rows. Migration `20260517_d_cta_label_prints_select_policy.sql` adds authenticated SELECT, keeps service-role ALL, and removes the old authenticated INSERT policy because prints are inserted by the `track-cta-label-print` Edge Function.

If label history fails to load, the workspace still opens and the Labels tab shows an inline error state.

## Labels Tab Contents

The Labels tab shows:

- CTA source and eligibility status.
- Current label type rule: review CTA, channel CTA, or none.
- Scan tracking status.
- Print history with print time, label type, source, coupon, destination, scan count, latest scan, and a shortened print ID.
- Scan summary with total scans, latest scan timestamp, and link count.
- Link/token rows with tracking URL, destination URL, scan count, latest scan, shortened token, and copy button.

The tab avoids displaying raw IP addresses, full user agents, customer contact info, or full internal IDs prominently.

## Intentionally Deferred

- No reprint button inside the workspace.
- No new print actions inside the workspace.
- No coupon attribution changes.
- No Amazon CTA support.
- No scan charts.
- No QR redirect changes.
- No SMS `/r/?c=<code>` redirect changes.

## Test Results

Completed validation:

- `git diff --check` passed.
- `node --check` passed for `js/admin/lineItemsOrders/*.js`.
- Cursor diagnostics showed no linter errors for the changed JS files.
- Headless Edge could load the local admin shell, but the unauthenticated smoke test redirected to the admin dashboard before exercising order workspace data.
- Live authenticated follow-up confirmed the Labels tab rendered for KK, eBay, and no-history orders.
- Live authenticated follow-up found `cta_label_prints` rows were hidden by missing authenticated SELECT RLS.
- After the RLS fix, live authenticated follow-up confirmed print rows load and Print History renders for orders with CTA print history.

Manual authenticated browser follow-up still recommended:

- Manual copy-button verification in a non-headless browser, if desired.
