# Phase 1 — RPC and secret-risk lockdown

Date: 2026-06-18

Migration: `supabase/migrations/20261101_security_phase1_rpc_secret_lockdown.sql`

Verification: `node scripts/verify-security-phase1-rpc-lockdown.mjs`

## What this phase does

1. Creates or replaces `public.is_admin()` as `SECURITY DEFINER` with `SET search_path = public`, reading `auth.jwt() -> app_metadata ->> is_admin`.
2. Revokes `anon` `EXECUTE` on all `SECURITY DEFINER` functions except the storefront allowlist (`get_product_stock`).
3. Restricts service/cron-only RPCs to `service_role` (Amazon vault, marketplace sale hold/release, analytics backfill, queue workers, cron triggers).
4. Grants `authenticated` + `service_role` execute on admin UI RPCs (internal `is_admin()` guards remain required in function bodies).
5. Explicitly revokes `anon` from `rpc_order_kpis`.

## Manual dashboard tasks (not automated in repo)

These must be completed by a project owner:

1. **Rotate Supabase service role key**
   - Dashboard → Project Settings → API → Service role → Regenerate
   - Update local `.env` only (never commit)
   - Verify Edge Functions and cron jobs after rotation

2. **Resolve GitHub secret scanning alert**
   - The service role JWT was removed from `pages/admin/settings.html` in commit `1cfcf3c`, but remains in git history.
   - After rotation: GitHub → Security → Secret scanning → mark alert **Revoked/Rotated**

3. See also:
   - [docs/audit/security/002_service_role_key_remediation.md](../audit/security/002_service_role_key_remediation.md)
   - [docs/audit/security/003_supabase_key_rotation_followup.md](../audit/security/003_supabase_key_rotation_followup.md)

## Storefront allowlist

| Function | Reason |
|----------|--------|
| `get_product_stock` | Public stock read if used by storefront RPC path |

All other `SECURITY DEFINER` functions must not be callable by `anon`.

## Service-role-only RPCs

| Function | Caller |
|----------|--------|
| `amazon_get_lwa_refresh_token` | Edge Functions |
| `amazon_store_lwa_refresh_token` | Edge Functions |
| `analytics_backfill`, `analytics_refresh_day` | Cron |
| `claim_inventory_sale_sync_jobs` | Queue worker |
| `process_scheduled_posts_trigger` | Cron |
| `refresh_product_review_stats` | Cron |
| `refresh_inventory_issue_snapshots` | Cron |
| `reserve_inventory_for_marketplace_sale` | Sale webhooks |
| `release_marketplace_sale_reservation` | Cancel webhooks |

## Verification

```bash
node scripts/verify-security-phase1-rpc-lockdown.mjs
```

Expect:

- `is_admin()` hardened
- Anon denied on dangerous RPCs listed in the script
- No unexpected `anon EXECUTE` on `SECURITY DEFINER` functions

## Rollback

Re-grant only what is required after review. Do not re-grant `anon` on admin/inventory RPCs.
