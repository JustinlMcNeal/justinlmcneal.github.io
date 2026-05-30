# Auth Status Implementation (Phase 2E.1)

## Overview

Phase 2E.1 implements the first Amazon auth edge function: **`amazon-auth-status`**.

It returns **safe connection metadata** for the admin UI without OAuth, SP-API calls, or token exposure.

Planning baseline: [`014_auth_edge_function_plan.md`](014_auth_edge_function_plan.md)

---

## Function Created

| Path | Purpose |
|------|---------|
| `supabase/functions/amazon-auth-status/index.ts` | Read-only Amazon connection status for admin |

---

## Purpose

Let the Karry Kraze Amazon admin page (future wiring) determine:

- Whether Seller Central is connected
- Which seller account / region / marketplaces are configured
- Token lifecycle status (`active`, `revoked`, `expired`, `error`, `not_connected`)

**Does not** start OAuth, exchange codes, disconnect accounts, or call Amazon SP-API.

---

## Request

### Methods

| Method | Behavior |
|--------|----------|
| `OPTIONS` | CORS preflight |
| `GET` | Return auth status |
| `POST` | Return auth status |
| Other | `405` `{ ok: false, error: "method_not_allowed" }` |

### Headers

```
Authorization: Bearer <supabase_jwt>
Content-Type: application/json   (POST only, optional)
```

### Input

Optional `sellerAccountId`:

| Method | Source |
|--------|--------|
| `GET` | Query param `?sellerAccountId=<uuid>` |
| `POST` | JSON body `{ "sellerAccountId": "<uuid>" }` |

If omitted, returns the **default active account** using priority:

1. `amazon_seller_accounts.is_active = true` first
2. Newest `authorized_at`
3. Newest `created_at`

Invalid UUID → `400` `{ ok: false, error: "invalid_request" }`

---

## Admin Guard

Follows `analytics-aggregate` / `ebay-manage-listing`:

1. Require `Authorization` header → else `401 unauthorized`
2. If JWT role is not `service_role`:
   - Create anon client with user JWT
   - `auth.getUser()` → else `401`
   - `rpc("is_admin")` → else `403 forbidden`
3. Only after admin passes → create **service role** client for DB reads

Service role JWT bypasses admin check (same pattern as other admin functions).

---

## Tables Read

| Table | Columns selected | Notes |
|-------|------------------|-------|
| `amazon_seller_accounts` | `id`, `seller_id`, `account_label`, `region`, `marketplace_ids`, `is_active`, `authorized_at`, `last_token_refresh_at`, `token_status`, `created_at` | Safe metadata only |
| `amazon_auth_tokens` | `token_status`, `last_refresh_at`, `last_error` | **Never** `lwa_refresh_token_encrypted`, `vault_secret_name` |

---

## Response Shape

All success responses include `"ok": true`.

### No seller account

```json
{
  "ok": true,
  "connected": false,
  "tokenStatus": "not_connected"
}
```

### Connected (`token_status` active on account **and** token row)

```json
{
  "ok": true,
  "connected": true,
  "sellerAccountId": "uuid",
  "sellerId": "A***********1234",
  "region": "na",
  "marketplaceIds": ["ATVPDKIKX0DER"],
  "tokenStatus": "active",
  "authorizedAt": "2026-05-29T12:00:00.000Z",
  "lastTokenRefreshAt": "2026-05-29T13:00:00.000Z",
  "accountLabel": "Karry Kraze US",
  "isActive": true
}
```

### Account exists but not connected (revoked / expired / error / missing token)

```json
{
  "ok": true,
  "connected": false,
  "sellerAccountId": "uuid",
  "sellerId": "A***********1234",
  "region": "na",
  "marketplaceIds": ["ATVPDKIKX0DER"],
  "tokenStatus": "revoked",
  "authorizedAt": "2026-05-29T12:00:00.000Z",
  "lastTokenRefreshAt": null,
  "accountLabel": "Karry Kraze US",
  "isActive": false
}
```

### Errors

```json
{ "ok": false, "error": "<safe_code>" }
```

| Code | HTTP | When |
|------|------|------|
| `unauthorized` | 401 | Missing/invalid JWT |
| `forbidden` | 403 | Not admin |
| `method_not_allowed` | 405 | Unsupported method |
| `invalid_request` | 400 | Bad `sellerAccountId` |
| `database_error` | 500 | Query failure |
| `server_misconfigured` | 500 | Missing env vars |

Raw DB errors are **not** returned to clients.

---

## Token Safety Rules

**Never returned:**

- `lwa_refresh_token_encrypted`
- `vault_secret_name`
- `access_token` / `refresh_token`
- `client_secret`
- Full unmasked seller ID (masked in `sellerId` field)

**Safe logging only:**

- `[amazon-auth-status] start`
- `[amazon-auth-status] unauthorized` / `forbidden`
- `[amazon-auth-status] success connected=true|false`
- `[amazon-auth-status] database_error` / `server_misconfigured`

**Never logged:**

- Token values
- Vault secret names
- Full `Authorization` header
- Raw database error details

---

## Connection Logic

`connected: true` only when:

- `amazon_seller_accounts.token_status === 'active'`
- **and** `amazon_auth_tokens.token_status === 'active'`

`tokenStatus` in response prefers the token row when it indicates a non-active state; otherwise uses account status.

`lastTokenRefreshAt` uses the later of account `last_token_refresh_at` and token `last_refresh_at`.

---

## What Remains Unimplemented

| Item | Phase |
|------|-------|
| `amazon-auth-start` / `amazon-auth-callback` | ✅ 2E.2 — [`016`](016_auth_start_callback_implementation.md) |
| `amazon-auth-disconnect` | ✅ 2E.3 — [`017`](017_auth_disconnect_implementation.md) |
| `amazon-sync-listings` | ✅ 2F — [`018`](018_read_only_sync_prototype.md) |
| Frontend wiring in `js/admin/amazon/` | 2G |

---

## Future UI Wiring

After deploy, admin JS can:

```javascript
const resp = await fetch(`${SUPABASE_URL}/functions/v1/amazon-auth-status`, {
  method: "GET",
  headers: { Authorization: `Bearer ${session.access_token}` },
});
const status = await resp.json();
// status.connected → enable Sync Amazon button
// status.tokenStatus → show reconnect banner
```

Read `amazon_auth=success|error` URL params separately when callback ships in 2E.2.

---

## Environment Variables

Required at runtime (Supabase project secrets):

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

No Amazon-specific secrets needed for this read-only function.

---

## Related Docs

- [`014_auth_edge_function_plan.md`](014_auth_edge_function_plan.md) — full auth plan
- [`016_auth_start_callback_implementation.md`](016_auth_start_callback_implementation.md) — OAuth start/callback (2E.2)
- [`017_auth_disconnect_implementation.md`](017_auth_disconnect_implementation.md) — disconnect (2E.3)
- [`013_supabase_schema.md`](013_supabase_schema.md) — schema + RLS

---

## Validation Notes

- TypeScript follows existing edge function import style (`@supabase/supabase-js@2`, `Deno.serve`)
- No token secret columns in SELECT lists
- No frontend or HTML changes in this phase
- Deploy with `supabase functions deploy amazon-auth-status` when ready
