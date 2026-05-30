# Read-Only Sync Prototype (Phase 2F)

## Overview

Phase 2F implements the first **read-only** Amazon listings sync: admin-triggered `searchListingsItems` import into Supabase.

**Does not** create, update, patch, delete, or push listings on Amazon.

Prior auth phases: [`015`](015_auth_status_implementation.md) · [`016`](016_auth_start_callback_implementation.md) · [`017`](017_auth_disconnect_implementation.md)

**SigV4 transport (2H):** [`019_sigv4_sync_signing.md`](019_sigv4_sync_signing.md)

---

## Files Created

| Path | Purpose |
|------|---------|
| `supabase/functions/amazon-sync-listings/index.ts` | Admin-only sync edge function |
| `supabase/functions/_shared/amazonSpApiUtils.ts` | LWA refresh, SP-API GET, normalization helpers |
| `supabase/migrations/20260723_amazon_vault_read_rpc.sql` | Vault read RPC for refresh token |

---

## What the Sync Does

1. Verify admin JWT + `is_admin()`
2. Resolve active connected seller account + active token with Vault reference
3. Read LWA refresh token via `amazon_get_lwa_refresh_token` RPC (service role only)
4. Exchange refresh token → short-lived access token (LWA)
5. Create `amazon_sync_runs` row (`status = running`)
6. Call **read-only** `searchListingsItems` (GET Listings Items API)
7. Normalize each item → upsert `amazon_listings`
8. Replace open `sync`-source issues per listing in `amazon_listing_issues`
9. Record row/API failures in `amazon_sync_errors`
10. Finalize sync run (`success` / `partial_success` / `failed`)

---

## What It Does Not Do

- `putListingsItem`, `patchListingsItem`, `deleteListingsItem`
- Push/submit/feed workflows
- Mapping save
- FBA inventory enrichment
- Full catalog pagination (prototype capped at `maxPages` 1–5, default 1)
- Multi-marketplace per call (uses first enabled marketplace only)
- Frontend wiring

SigV4 signing: see [`019_sigv4_sync_signing.md`](019_sigv4_sync_signing.md) (Phase 2H).

---

## Vault Read RPC

### `amazon_get_lwa_refresh_token(p_seller_account_id uuid) → text`

- Joins `amazon_auth_tokens.vault_secret_name` → `vault.decrypted_secrets`
- Returns plaintext refresh token **to service_role edge functions only**
- No authenticated/anon grants
- Never logged or returned in sync HTTP response

---

## LWA Token Refresh Flow

```
POST https://api.amazon.com/auth/o2/token
grant_type=refresh_token
refresh_token=<from Vault RPC>
client_id=AMAZON_LWA_CLIENT_ID
client_secret=AMAZON_LWA_CLIENT_SECRET
```

On success:

- Uses `access_token` for SP-API GET only (not stored long-term)
- Updates `amazon_seller_accounts.last_token_refresh_at`
- Updates `amazon_auth_tokens.last_refresh_at`

On `invalid_grant` / revoked:

- Sync run → `failed`
- Optional account/token `token_status = error`
- Client error: `token_refresh_failed`

Request/response bodies are **never logged**.

---

## searchListingsItems Request

```
GET {endpoint}/listings/2021-08-01/items/{sellerId}
  ?marketplaceIds={marketplaceId}
  &includedData=summaries,attributes,issues,offers,fulfillmentAvailability,relationships,productTypes
  &pageSize=20
  &pageToken={optional}
```

Headers:

- `x-amz-access-token: <LWA access token>`
- `content-type: application/json`

Regional endpoints (default):

| Region | Host |
|--------|------|
| `na` | `sellingpartnerapi-na.amazon.com` |
| `eu` | `sellingpartnerapi-eu.amazon.com` |
| `fe` | `sellingpartnerapi-fe.amazon.com` |

Override: `AMAZON_SP_API_ENDPOINT` env var.

---

## Normalization Assumptions

| Field | Source |
|-------|--------|
| `seller_sku` | Item `sku` |
| ASIN, title, product type, condition | `summaries[]` for marketplace |
| Buyable/discoverable | Summary `status` contains `BUYABLE` / `DISCOVERABLE` |
| `listing_status` | ERROR issues → `issue`; qty 0 → `out_of_stock`; buyable → `active`; else `unknown`/inactive |
| Price | `offers[]` then `attributes.purchasable_offer` |
| FBM qty | `fulfillmentAvailability[].quantity` |
| FBA qty columns | Left null in prototype |
| `raw_listing` | Full SP-API item JSON (DB only) |

Missing fields → null/defaults; row processing continues.

---

## API Request

```
POST /functions/v1/amazon-sync-listings
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "sellerAccountId": "optional-uuid",
  "marketplaceIds": ["ATVPDKIKX0DER"],
  "syncType": "manual",
  "maxPages": 1
}
```

### Defaults

| Field | Default |
|-------|---------|
| `sellerAccountId` | Active connected account |
| `marketplaceIds` | Account `marketplace_ids` or `ATVPDKIKX0DER` |
| `syncType` | `manual` |
| `maxPages` | `1` (max 5) |

### Success response

```json
{
  "ok": true,
  "syncRunId": "uuid",
  "status": "success",
  "recordsSeen": 20,
  "recordsUpdated": 20,
  "recordsFailed": 0,
  "pagesFetched": 1
}
```

No raw listing payloads or tokens in response.

### Safe errors

`unauthorized`, `forbidden`, `method_not_allowed`, `invalid_request`, `server_misconfigured`, `amazon_not_connected`, `token_missing`, `token_refresh_failed`, `sp_api_request_failed`, `database_error`

---

## Tables Written

| Table | Operation |
|-------|-----------|
| `amazon_sync_runs` | INSERT + UPDATE |
| `amazon_listings` | UPSERT on `(seller_account_id, marketplace_id, seller_sku)` |
| `amazon_sync_errors` | INSERT on API/row failures |
| `amazon_listing_issues` | DELETE open sync issues + INSERT current issues |
| `amazon_seller_accounts` | UPDATE refresh timestamps; optional `token_status=error` |
| `amazon_auth_tokens` | UPDATE refresh timestamps; optional error status |

**Not deleted:** mappings, drafts, historical sync runs (except cascade rules), listing rows absent from page (no purge).

---

## Security Rules

**Never logged/returned:**

- Refresh/access tokens, client secret
- Vault secret value or `vault_secret_name`
- Authorization header
- Full LWA or SP-API response bodies

**Admin-only:** `requireAdminJson()` before service role usage.

---

## Known Limitations

1. ~~**No AWS SigV4 signing**~~ — **Addressed in 2H:** [`019_sigv4_sync_signing.md`](019_sigv4_sync_signing.md)
2. **Prototype pagination** — default 1 page × 20 items; not full catalog.
3. **Single marketplace per call** — additional IDs ignored with warning.
4. **`records_created`** — not tracked; all successful upserts counted as `records_updated`.
5. **No listing purge** — SKUs not returned in search remain in DB.
6. **FBA quantities** — not populated (Listings fulfillment only).

---

## Deployment

1. Apply migrations:
   - `20260722_amazon_oauth_states.sql` (if not applied)
   - `20260723_amazon_vault_read_rpc.sql`
2. Set secrets:
   - `AMAZON_LWA_CLIENT_ID`, `AMAZON_LWA_CLIENT_SECRET`
   - `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (required — see [`019_sigv4_sync_signing.md`](019_sigv4_sync_signing.md))
   - Optional: `AWS_REGION`, `AWS_SESSION_TOKEN`, `AMAZON_SP_API_ENDPOINT`
3. Deploy:
   ```bash
   supabase functions deploy amazon-sync-listings
   ```
4. Requires connected Amazon account (Phase 2E.2) before sync will succeed.

---

## Recommended Next Phase

**2G** — Frontend wiring: auth status panel, Connect/Reconnect/Disconnect, Sync button, live reads from `v_amazon_listing_workspace`.

**2H** — ✅ SigV4 signing — [`019_sigv4_sync_signing.md`](019_sigv4_sync_signing.md)

**2G** — ✅ Frontend wiring — [`020_frontend_live_wiring.md`](020_frontend_live_wiring.md)

**2I** — ✅ Incremental/full sync — [`021_incremental_full_sync.md`](021_incremental_full_sync.md)

**2J** — Mapping save + KK product link workflow.

---

## Related Docs

- [`012_official_sp_api_research.md`](012_official_sp_api_research.md)
- [`013_supabase_schema.md`](013_supabase_schema.md)
- [`014_auth_edge_function_plan.md`](014_auth_edge_function_plan.md)
- [`019_sigv4_sync_signing.md`](019_sigv4_sync_signing.md)
- [`020_frontend_live_wiring.md`](020_frontend_live_wiring.md)
- [`021_incremental_full_sync.md`](021_incremental_full_sync.md)
