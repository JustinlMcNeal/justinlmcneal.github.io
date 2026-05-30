# Auth Start + Callback Implementation (Phase 2E.2)

## Overview

Phase 2E.2 implements the Amazon LWA OAuth **start** and **callback** edge functions plus OAuth state storage.

Planning baseline: [`014_auth_edge_function_plan.md`](014_auth_edge_function_plan.md)

Prior phase: [`015_auth_status_implementation.md`](015_auth_status_implementation.md)

**Not included:** SP-API listing sync, frontend wiring, access-token refresh helper for sync. Disconnect: ✅ [`017_auth_disconnect_implementation.md`](017_auth_disconnect_implementation.md)

---

## Migration Created

| File | Purpose |
|------|---------|
| `supabase/migrations/20260722_amazon_oauth_states.sql` | `amazon_oauth_states` table + Vault helper RPC |

### `amazon_oauth_states`

Stores **SHA-256 hash** of OAuth state (never raw state).

| Column | Notes |
|--------|-------|
| `state_hash` | UNIQUE lookup key |
| `created_by` | Admin user uuid from JWT |
| `region` | `na` / `eu` / `fe` |
| `marketplace_ids` | Validated marketplace list |
| `redirect_after` | Safe admin path after OAuth |
| `expires_at` | ~10 minutes from creation |
| `used_at` | Set on successful state validation (single-use) |

**RLS:** Enabled; **service_role only** (no authenticated/anon policies or grants).

### `amazon_store_lwa_refresh_token(uuid, text)`

`SECURITY DEFINER` Postgres function:

- Creates or updates Vault secret `amazon_lwa_refresh_<seller_account_id>`
- Returns secret name for `amazon_auth_tokens.vault_secret_name`
- `GRANT EXECUTE` to **service_role** only

---

## Functions Created

| Path | Methods | Auth |
|------|---------|------|
| `supabase/functions/amazon-auth-start/index.ts` | `OPTIONS`, `POST` | Admin JWT + `is_admin()` |
| `supabase/functions/amazon-auth-callback/index.ts` | `OPTIONS`, `GET` | OAuth state (no JWT) |

Shared helpers: `supabase/functions/_shared/amazonAuthUtils.ts`

---

## `amazon-auth-start` Behavior

### Request

```
POST /functions/v1/amazon-auth-start
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "region": "na",
  "marketplaceIds": ["ATVPDKIKX0DER"],
  "redirectAfter": "/pages/admin/amazon.html"
}
```

All body fields optional.

**Defaults:**

| Field | Default |
|-------|---------|
| `region` | `AMAZON_SP_API_REGION` or `na` |
| `marketplaceIds` | `[AMAZON_DEFAULT_MARKETPLACE_ID]` or `["ATVPDKIKX0DER"]` |
| `redirectAfter` | `/pages/admin/amazon.html` |

### Validation

- `region` ∈ `{ na, eu, fe }`
- `marketplaceIds` non-empty strings, all enabled in `amazon_marketplaces` for region
- `redirectAfter` must be safe local path under `/pages/admin/`

### Flow

1. Admin guard (`getUser` + `is_admin()`)
2. Generate random state (`crypto.randomUUID()`)
3. Insert SHA-256 hash into `amazon_oauth_states` (10 min TTL)
4. Build Seller Central consent URL by region
5. Return `{ ok: true, redirectUrl }` — **no token values**

### Consent URL bases

| Region | Base |
|--------|------|
| `na` | `https://sellercentral.amazon.com/apps/authorize/consent` |
| `eu` | `https://sellercentral-europe.amazon.com/apps/authorize/consent` |
| `fe` | `https://sellercentral.amazon.co.jp/apps/authorize/consent` |

Query params: `application_id`, `state`, `redirect_uri`

> **TODO:** Confirm whether `version=beta` is required for the current SP-API app registration (comment left in code).

### Required env vars

- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `AMAZON_APP_ID`, `AMAZON_AUTH_REDIRECT_URI`

Optional: `AMAZON_SP_API_REGION`, `AMAZON_DEFAULT_MARKETPLACE_ID`

---

## `amazon-auth-callback` Behavior

### Request

Amazon browser redirect:

```
GET /functions/v1/amazon-auth-callback?code=...&state=...&selling_partner_id=...
```

Also accepts `spapi_oauth_code` instead of `code`.

### Security model

No JWT — trust from:

- Valid state hash in DB
- Not expired
- Single-use (`used_at` null → set on validation)

### Flow

1. If `error` query param → redirect `user_denied`
2. Require authorization code + state
3. Lookup state by SHA-256 hash; reject invalid/expired/used
4. Mark state used (atomic update)
5. Validate marketplaces from state row
6. Exchange code at `POST https://api.amazon.com/auth/o2/token`
7. Require refresh token in LWA response
8. Resolve seller ID from `selling_partner_id` query param (no SP-API profile call)
9. Upsert `amazon_seller_accounts` on `seller_id`
10. Store refresh token via `amazon_store_lwa_refresh_token` RPC → Vault
11. Upsert `amazon_auth_tokens` with `vault_secret_name` only (encrypted column NULL)
12. HTTP 302 redirect — **no JSON body**

### Redirects

| Outcome | URL |
|---------|-----|
| Success | `https://karrykraze.com/pages/admin/amazon.html?amazon_auth=success` |
| Error | `...?amazon_auth=error&reason=<safe_code>` |

Uses `redirect_after` from state when safe; otherwise default admin path.

### Safe error codes

`missing_code`, `invalid_state`, `state_already_used`, `state_expired`, `user_denied`, `token_exchange_failed`, `missing_refresh_token`, `missing_seller_id`, `unsupported_region`, `unsupported_marketplace`, `db_write_failed`, `vault_write_failed`, `server_misconfigured`, `method_not_allowed`

### Required env vars

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- `AMAZON_LWA_CLIENT_ID`, `AMAZON_LWA_CLIENT_SECRET`, `AMAZON_AUTH_REDIRECT_URI`

---

## Token Storage Approach

**Decision: Supabase Vault (preferred path implemented)**

1. Callback calls RPC `amazon_store_lwa_refresh_token(seller_account_id, refresh_token)`
2. RPC upserts Vault secret named `amazon_lwa_refresh_<uuid>`
3. `amazon_auth_tokens.vault_secret_name` stores reference
4. `lwa_refresh_token_encrypted` remains NULL

**No plaintext fallback** — if Vault RPC fails, callback redirects with `vault_write_failed` and does not persist token in Postgres.

Future sync functions should read refresh token via Vault (`vault.decrypted_secrets` or equivalent) using service role.

---

## Security Rules

### Never logged

- Authorization `code`, raw `state`
- Refresh/access tokens, client secret
- Full callback URL, full LWA response
- Vault secret plaintext or secret name (avoided in logs)

### Never returned to browser

- Tokens in JSON or redirect query strings
- `vault_secret_name`, `lwa_refresh_token_encrypted`

### Safe logs

- `[amazon-auth-start] start|success|unauthorized|forbidden|database_error|server_misconfigured`
- `[amazon-auth-callback] start|success|invalid_state|token_exchange_failed|vault_write_failed|...`

---

## What Remains Unimplemented

| Item | Phase |
|------|-------|
| `amazon-auth-disconnect` | ✅ 2E.3 — [`017_auth_disconnect_implementation.md`](017_auth_disconnect_implementation.md) |
| Frontend Connect button + start flow | 2G |
| LWA access-token refresh helper for sync | 2F |
| SP-API `searchListingsItems` sync | 2F |
| `version=beta` consent param confirmation | Ops / live test |
| Seller ID fallback via SP-API if query param absent | Future if required |
| OAuth state cleanup cron | Optional ops |

---

## Deploy Notes

1. Apply migration: `supabase db push` or run `20260722_amazon_oauth_states.sql`
2. Set Supabase secrets:
   - `AMAZON_APP_ID`
   - `AMAZON_AUTH_REDIRECT_URI` → `https://<project>.supabase.co/functions/v1/amazon-auth-callback`
   - `AMAZON_LWA_CLIENT_ID`
   - `AMAZON_LWA_CLIENT_SECRET`
   - Optional: `AMAZON_SP_API_REGION`, `AMAZON_DEFAULT_MARKETPLACE_ID`
3. Register redirect URI in Amazon Developer Console / Seller Central app
4. Deploy functions:
   ```bash
   supabase functions deploy amazon-auth-start
   supabase functions deploy amazon-auth-callback --no-verify-jwt
   ```
   Callback must allow unauthenticated JWT verification skip (Amazon redirect has no Supabase JWT).

5. Test flow manually from future UI or curl:
   - POST `amazon-auth-start` with admin JWT → open `redirectUrl`
   - Complete Amazon consent → verify redirect to admin page with `amazon_auth=success`
   - GET `amazon-auth-status` with admin JWT → `connected: true`

---

## Related Docs

- [`014_auth_edge_function_plan.md`](014_auth_edge_function_plan.md)
- [`015_auth_status_implementation.md`](015_auth_status_implementation.md)
- [`013_supabase_schema.md`](013_supabase_schema.md)
