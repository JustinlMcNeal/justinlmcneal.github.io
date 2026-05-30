# Phase 2G — Frontend Live Wiring

Wire the Amazon admin page to auth edge functions, manual sync, and live listing reads from Supabase.

**Previous:** [2F read-only sync](018_read_only_sync_prototype.md) · [2H SigV4 signing](019_sigv4_sync_signing.md)

---

## Files Created

| File | Purpose |
|------|---------|
| `js/admin/amazon/api.js` | Session + edge function calls + `v_amazon_listing_workspace` read |
| `js/admin/amazon/authStatus.js` | Auth panel, connect/reconnect/disconnect, URL param handling |
| `js/admin/amazon/syncActions.js` | Sync button binding, in-progress UI, post-sync refresh |
| `js/admin/amazon/liveListings.js` | Fetch live rows, empty/error states, refresh hook |
| `js/admin/amazon/renderListings.js` | Table/mobile render, stats/count labels, HTML escape |
| `js/admin/amazon/notifications.js` | Inline toast in auth panel |

## Files Modified

| File | Change |
|------|--------|
| `pages/admin/amazon.html` | `#amazonAuthPanel`, toast region, sync/connect hooks, count/pagination IDs |
| `js/admin/amazon/index.js` | Admin guard, module bootstrap |
| `css/pages/admin/amazon.css` | No changes required (Tailwind in HTML) |

Existing Phase 2A modules unchanged: `tabs.js`, `modals.js`, `rowActions.js`, `mockHydration.js`, `dom.js`.

---

## Auth Status UI

Panel ID: `#amazonAuthPanel` with `data-auth-state`:

| State | When | Actions |
|-------|------|---------|
| `loading` | Initial status fetch | — |
| `connected` | `connected && tokenStatus === active` | Disconnect (header Sync enabled) |
| `disconnected` | No account / not connected | Connect Amazon |
| `revoked` | Token revoked/expired/error | Reconnect Amazon |
| `error` | Status fetch failed | Reconnect Amazon |

Data loaded from `GET /functions/v1/amazon-auth-status` (admin JWT). Displays masked `sellerId`, marketplace label, `lastTokenRefreshAt`.

### URL redirect params

After OAuth callback redirect:

- `?amazon_auth=success` → success toast, params stripped
- `?amazon_auth=error&reason=<code>` → mapped friendly message (no raw server text)

Known reason codes: `user_denied`, `invalid_state`, `state_already_used`, `state_expired`, `token_exchange_failed`, `missing_seller_id`, `vault_write_failed`, `db_write_failed`, `server_misconfigured`, `missing_code`.

---

## Connect / Reconnect

- **Connect** (`data-action="connect-amazon"`) and **Reconnect** (`data-action="reconnect-amazon"`) call `POST amazon-auth-start` with admin JWT.
- On success: `window.location.href = redirectUrl` (Amazon consent).
- `redirectAfter`: `/pages/admin/amazon.html`.

---

## Disconnect

- **Disconnect** (`data-action="disconnect-amazon"`) confirms, then `POST amazon-auth-disconnect`.
- Soft revoke only; no Vault delete, no listing history delete.
- Refreshes auth panel after success.

---

## Sync Button

- Header **Sync Amazon** (`data-action="sync-amazon"`) — primary control; auth panel does not duplicate sync to avoid confusion.
- Disabled unless auth status is connected + active token (`data-auth-disabled` + `disabled`).
- Click → `POST amazon-sync-listings` with `{ syncType: "manual", maxPages: 1 }`.
- While syncing: `#amazonStateSyncing` banner, button label “Syncing…”, double-click blocked.
- On success: toast with update count, refresh listings + stats + auth status.
- On failure: safe error message by error code (no raw SP-API bodies).

---

## Live Listings Read

**Source:** `v_amazon_listing_workspace` via Supabase anon client + RLS (admin session).

**Columns:** Safe workspace fields only (no tokens, no raw SP-API JSON).

**Query:** `last_synced_at desc nulls last`, limit 50.

**Render:**

- Replaces `#amazonListingsBody` and `#amazonMobileCards` when rows exist.
- Mock HTML rows remain until first successful fetch completes.
- Empty + connected → `#amazonStateEmpty`.
- Fetch error → `#amazonStateError` + toast.

**Fallbacks:**

- Title: `kk_product_title || amazon_title || "Untitled Amazon Listing"`
- SKU: `kk_sku || seller_sku`
- Inventory: `kk_stock`, then `fbm_quantity`, then FBA fulfillable
- Profit / Amazon fee: placeholder `—`

---

## Stats Update

After live fetch, `#amazonStats` cards update via `data-stat` hooks:

| Hook | Logic |
|------|-------|
| `total` | Row count (max 50 loaded) |
| `active` | `listing_status === "active"` |
| `low-stock` | `listing_status === "low_stock"` or `kk_stock <= 5` |
| `issues` | `open_issue_count > 0` or status `issue` / `suppressed` |

Tab synced count (`#amazonTabSynced [data-count]`) and table/pagination labels update with live totals.

---

## Remains Mock / Static

- **Ready to Push** — ✅ Live query — [`028_ready_to_push_live.md`](028_ready_to_push_live.md)
- **Needs Mapping**, **Drafts / Issues** tabs — live
- **Push KK Product**, **Import / Map Existing** modals — Phase 2A placeholders (open UI, no save).
- **Export** — disabled.
- Row action menus — open popover/modals only; no backend mutations.
- Pagination controls — disabled; live view shows up to 50 rows, no paging.
- Search/filter bar — disabled preview controls.

---

## Security Rules (enforced)

| Rule | Implementation |
|------|----------------|
| No SP-API in browser | All Amazon calls via edge functions only |
| No service role key | `SUPABASE_ANON_KEY` + user JWT only |
| No AWS credentials in frontend | SigV4 server-side only |
| No LWA tokens in frontend | Vault + edge functions only |
| No `amazon_auth_tokens` reads | Status function returns safe metadata only |
| No direct Amazon URLs from sync | OAuth redirect via `amazon-auth-start` only |

---

## Known Limitations

1. Sync prototype: `maxPages: 1`, single marketplace, page size 20 — not full catalog.
2. Listings read capped at 50 rows; no server pagination or filters.
3. Profit and Amazon fee columns are placeholders.
4. Stats reflect loaded rows only, not full account totals.
5. Historical DB rows may display when disconnected (read-only workspace data).
6. Push, mapping save, export, and row mutations not implemented.

---

## Validation Checklist

- [x] Auth panel added
- [x] `amazon-auth-status` from frontend
- [x] Connect → `amazon-auth-start` → Amazon redirect
- [x] Disconnect → `amazon-auth-disconnect`
- [x] Sync → `amazon-sync-listings` when connected
- [x] Live read from `v_amazon_listing_workspace`
- [x] Table + mobile cards from live rows
- [x] Stats from live rows
- [x] URL params `amazon_auth=success|error`
- [x] No secrets/tokens/AWS in frontend JS
- [x] Tabs/modals/row menus preserved
- [x] All new JS modules &lt; 500 lines

---

## Recommended Next Phase

**2I** — ✅ Incremental/full sync — [`021_incremental_full_sync.md`](021_incremental_full_sync.md)

**2J** — ✅ Mapping save — [`022_mapping_save_workflow.md`](022_mapping_save_workflow.md)

**2K** — ✅ Local push draft — [`023_push_draft_workflow.md`](023_push_draft_workflow.md)

**2L** — SP-API submit behind edge functions.

---

## Related Docs

- [`018_read_only_sync_prototype.md`](018_read_only_sync_prototype.md)
- [`019_sigv4_sync_signing.md`](019_sigv4_sync_signing.md)
- [`021_incremental_full_sync.md`](021_incremental_full_sync.md)
- [`022_mapping_save_workflow.md`](022_mapping_save_workflow.md)
- [`023_push_draft_workflow.md`](023_push_draft_workflow.md)
- [`028_ready_to_push_live.md`](028_ready_to_push_live.md)
- [`015_auth_status_implementation.md`](015_auth_status_implementation.md)
- [`016_auth_start_callback_implementation.md`](016_auth_start_callback_implementation.md)
- [`017_auth_disconnect_implementation.md`](017_auth_disconnect_implementation.md)
