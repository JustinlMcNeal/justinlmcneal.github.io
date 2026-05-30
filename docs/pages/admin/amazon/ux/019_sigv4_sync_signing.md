# AWS SigV4 Signing for Read-Only Sync (Phase 2H)

## Overview

Phase 2H adds **AWS Signature Version 4** signing to the read-only `amazon-sync-listings` flow so `searchListingsItems` can authenticate against live Amazon SP-API.

Prior prototype: [`018_read_only_sync_prototype.md`](018_read_only_sync_prototype.md)

**Still read-only** — no `put`/`patch`/`delete` listing operations.

---

## Why SigV4 Was Added

Amazon SP-API requires:

1. **LWA access token** (`x-amz-access-token`) from refresh token exchange
2. **AWS SigV4** request signing with IAM user/role credentials (`execute-api` service)

Phase 2F sent only the LWA header; live calls often returned **401/403**. Phase 2H signs GET requests before fetch.

---

## Files Changed

| Path | Change |
|------|--------|
| `supabase/functions/_shared/amazonSpApiUtils.ts` | LWA refresh, normalization, signed `searchListingsItemsPage` |
| `supabase/functions/_shared/amazonSigV4Utils.ts` | AWS SigV4 signing (`signSpApiRequest`) |
| `supabase/functions/amazon-sync-listings/index.ts` | Reads AWS env vars; passes signing config; strict mode |

No new migration in this phase.

---

## Required Env Vars

| Variable | Required | Purpose |
|----------|----------|---------|
| `AWS_ACCESS_KEY_ID` | Yes (strict mode) | SigV4 access key |
| `AWS_SECRET_ACCESS_KEY` | Yes (strict mode) | SigV4 secret |
| `AWS_REGION` | Optional | Signing region override |
| `AWS_SESSION_TOKEN` | Optional | Temporary credentials |
| `AMAZON_ALLOW_UNSIGNED_SP_API` | Optional | Set `true` to allow legacy unsigned prototype calls |

Existing LWA vars unchanged: `AMAZON_LWA_CLIENT_ID`, `AMAZON_LWA_CLIENT_SECRET`, etc.

**Strict mode (default):** missing AWS key/secret → `server_misconfigured` before SP-API call.

---

## AWS Region Mapping

Signing region (not SP-API hostname region):

| SP-API account region | Default `AWS_REGION` |
|-----------------------|----------------------|
| `na` | `us-east-1` |
| `eu` | `eu-west-1` |
| `fe` | `us-west-2` |

If `AWS_REGION` env is set, it overrides the mapping.

SP-API host still from `getAmazonEndpoint()` (`sellingpartnerapi-na.amazon.com`, etc.).

---

## What Request Is Signed

```
GET /listings/2021-08-01/items/{sellerId}
```

Query params (canonical sorted for signature):

- `marketplaceIds`
- `includedData`
- `pageSize`
- `pageToken` (when paginating)

**Service:** `execute-api`

**Signed headers include:**

- `host`
- `x-amz-access-token` (LWA — value never logged)
- `x-amz-date`
- `x-amz-content-sha256` (empty body hash for GET)
- `user-agent`
- `content-type`
- `x-amz-security-token` (if `AWS_SESSION_TOKEN` set)

**Payload hash:** SHA-256 of empty string for GET.

Implementation uses Deno **Web Crypto** (`crypto.subtle`) — no external signing package.

---

## Error Behavior

SP-API failures still return client error `sp_api_request_failed`.

Safe hints stored in `amazon_sync_errors.raw_error` and sync run `summary.warnings`:

| HTTP | Hint |
|------|------|
| 401 / 403 (signed) | `sigv4_failed_or_permission_denied` |
| 401 / 403 (unsigned fallback) | `sigv4_may_be_required` |
| 429 | `rate_limited` |
| 5xx | `sp_api_unavailable` |

Logs: `[amazon-sync-listings] sp_api_request_failed status=403` — **no** Authorization header, tokens, or response body.

---

## Security Rules

**Never logged or returned:**

- `AWS_SECRET_ACCESS_KEY`, full `AWS_ACCESS_KEY_ID`
- `AWS_SESSION_TOKEN`
- SigV4 `Authorization` header
- `x-amz-access-token`, LWA refresh/access tokens
- Full SP-API response bodies in HTTP JSON response

**Sync HTTP response** remains metadata only (`syncRunId`, counts, status).

---

## What Remains Read-Only

- Only `searchListingsItems` GET
- No listing create/update/delete on Amazon
- No push/submit/feed
- No frontend changes
- Prototype pagination limits unchanged (`maxPages` 1–5)

---

## Deployment Notes

1. Create IAM user/role with SP-API developer access (per Amazon Developer Console setup).
2. Set Supabase function secrets:
   ```
   AWS_ACCESS_KEY_ID
   AWS_SECRET_ACCESS_KEY
   AWS_REGION=us-east-1   # if not using default mapping
   ```
3. Redeploy:
   ```bash
   supabase functions deploy amazon-sync-listings
   ```
4. Run manual sync; check `amazon_sync_runs.summary.sigv4 === true`.

---

## Known Limitations

1. **Single marketplace per call** — unchanged from 2F
2. **Limited pagination** — prototype cap still applies
3. **IAM permission errors** — may still 403 with valid signature if roles/scopes missing
4. **Temporary credentials** — supported via `AWS_SESSION_TOKEN`; not tested in CI
5. **Sandbox endpoints** — separate host override via `AMAZON_SP_API_ENDPOINT` only; signing region must still match

---

## Recommended Next Phase

**2G** — ✅ Frontend wiring — [`020_frontend_live_wiring.md`](020_frontend_live_wiring.md)

**2I** — Incremental/full sync strategy (`lastUpdatedAfter`, multi-page catalog, multi-marketplace).

---

## Related Docs

- [`018_read_only_sync_prototype.md`](018_read_only_sync_prototype.md)
- [`020_frontend_live_wiring.md`](020_frontend_live_wiring.md)
- [`012_official_sp_api_research.md`](012_official_sp_api_research.md)
