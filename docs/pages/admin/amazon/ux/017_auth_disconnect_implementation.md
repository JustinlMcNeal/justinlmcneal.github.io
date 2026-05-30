# Auth Disconnect Implementation (Phase 2E.3)

## Overview

Phase 2E.3 implements **`amazon-auth-disconnect`** — a soft-revoke endpoint that marks the Amazon seller account and token as disconnected without deleting historical listing data.

Planning baseline: [`014_auth_edge_function_plan.md`](014_auth_edge_function_plan.md)

Prior phases:

- [`015_auth_status_implementation.md`](015_auth_status_implementation.md) — `amazon-auth-status`
- [`016_auth_start_callback_implementation.md`](016_auth_start_callback_implementation.md) — OAuth start/callback

**Not included:** SP-API calls, Vault secret deletion, frontend wiring, listing sync.

---

## Function Created

| Path | Methods | Auth |
|------|---------|------|
| `supabase/functions/amazon-auth-disconnect/index.ts` | `OPTIONS`, `POST` | Admin JWT + `is_admin()` |

Shared helpers: `maskSellerId`, `requireAdminJson`, `UUID_RE` from `_shared/amazonAuthUtils.ts`

---

## Purpose

Allow an admin to **disconnect** Amazon integration when:

- Token should no longer be used for sync
- UI shows “Reconnect” flow later
- Historical `amazon_listings`, mappings, sync runs, issues, and drafts must remain intact

This completes the auth lifecycle alongside status, start, and callback.

---

## Request

```
POST /functions/v1/amazon-auth-disconnect
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "sellerAccountId": "optional-uuid"
}
```

Empty body `{}` is valid.

### Default account selection

When `sellerAccountId` is omitted:

1. `is_active = true` first
2. Newest `authorized_at`
3. Newest `created_at`

Invalid UUID → `400` `{ ok: false, error: "invalid_request" }`

---

## Admin Guard

Uses `requireAdminJson()` from `_shared/amazonAuthUtils.ts`:

| Condition | Response |
|-----------|----------|
| Missing JWT | `401 unauthorized` |
| Non-admin | `403 forbidden` |
| Admin OK | Service role client for updates |

---

## Tables Updated

| Table | Changes |
|-------|---------|
| `amazon_seller_accounts` | `token_status = 'revoked'`, `is_active = false`, `updated_at = now()` |
| `amazon_auth_tokens` | `token_status = 'revoked'`, `last_error = 'admin_disconnected'`, `updated_at = now()` |

**SELECT columns:** `id`, `seller_id` only on seller account lookup — no token secret columns read or returned.

### Not deleted or modified

- `amazon_listings`
- `amazon_listing_mappings`
- `amazon_listing_drafts`
- `amazon_sync_runs` / `amazon_sync_errors`
- `amazon_listing_issues`
- `amazon_push_queue`
- `amazon_product_type_cache`

---

## Idempotent Behavior

### No seller account found

Returns success (safe no-op):

```json
{
  "ok": true,
  "disconnected": true,
  "connected": false,
  "tokenStatus": "not_connected"
}
```

### Account found (including already revoked)

Returns:

```json
{
  "ok": true,
  "disconnected": true,
  "connected": false,
  "sellerAccountId": "uuid",
  "sellerId": "A***********1234",
  "tokenStatus": "revoked",
  "isActive": false
}
```

Calling disconnect twice on the same account remains safe.

---

## Token / Vault Safety

**Never returned:**

- `vault_secret_name`
- `lwa_refresh_token_encrypted`
- Refresh/access tokens

**Never logged:**

- Token values
- Vault secret names
- Authorization header
- Raw DB errors

**Vault secret delete deferred:**

- No tested Vault delete helper exists in repo
- `vault_secret_name` row reference is left in place
- Reconnect (2E.2 callback) overwrites Vault secret via `amazon_store_lwa_refresh_token`
- Orphan Vault secrets can be cleaned manually in ops if needed

Soft disconnect is safer: listings history stays queryable; reconnect upserts without duplicating seller rows.

---

## Error Responses

```json
{ "ok": false, "error": "<safe_code>" }
```

| Code | HTTP |
|------|------|
| `unauthorized` | 401 |
| `forbidden` | 403 |
| `method_not_allowed` | 405 |
| `invalid_request` | 400 |
| `database_error` | 500 |
| `server_misconfigured` | 500 |

---

## Future UI Wiring

After Phase 2G, admin page can:

```javascript
await fetch(`${SUPABASE_URL}/functions/v1/amazon-auth-disconnect`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${session.access_token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({}),
});
```

Then refresh `amazon-auth-status` → expect `connected: false`, `tokenStatus: "revoked"`.

Show reconnect banner and enable **Connect Amazon** again.

---

## Deploy

```bash
supabase functions deploy amazon-auth-disconnect
```

Requires env vars (same as other auth functions):

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

No Amazon-specific secrets required for disconnect.

---

## Related Docs

- [`014_auth_edge_function_plan.md`](014_auth_edge_function_plan.md)
- [`015_auth_status_implementation.md`](015_auth_status_implementation.md)
- [`016_auth_start_callback_implementation.md`](016_auth_start_callback_implementation.md)

---

## Recommended Next Phase

**2G** — Frontend wiring: auth status, Connect/Sync/Disconnect buttons, live reads from `v_amazon_listing_workspace`.

**2F** completed: [`018_read_only_sync_prototype.md`](018_read_only_sync_prototype.md)
