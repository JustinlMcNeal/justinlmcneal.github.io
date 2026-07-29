# KK Supabase Security Remediation (5 phases)

Audit source: [docs/audit/security/004_supabase_security_advisor_remediation.md](../audit/security/004_supabase_security_advisor_remediation.md)

Implementation date: 2026-06-18

This document summarizes the five-phase remediation that hardens the Karry Kraze Supabase project from Security Advisor findings to production-ready database enforcement.

## Executive summary

| Phase | Focus | Migration |
|-------|--------|-----------|
| **1** | RPC + secret-risk lockdown | `20261101_security_phase1_rpc_secret_lockdown.sql` |
| **2** | Core RLS (PII, orders, webhooks, ops) | `20261102_security_phase2_core_rls.sql` |
| **3** | Security invoker views + grant classification | `20261103_security_phase3_security_invoker_views.sql` |
| **4** | Policies, search_path, storage, extensions | `20261104_security_phase4_policy_function_storage_hardening.sql` |
| **5** | Final verification freeze | (scripts + this doc) |

Database RLS and grants are the security boundary. JavaScript `requireAdmin()` is UX only.

---

## Phase 1 — Emergency RPC and secret-risk lockdown

**Goal:** `anon` cannot execute sensitive `SECURITY DEFINER` RPCs.

**Files:**

- `supabase/migrations/20261101_security_phase1_rpc_secret_lockdown.sql`
- `scripts/verify-security-phase1-rpc-lockdown.mjs`
- `docs/security/kk_security_phase1_rpc_secret_lockdown.md`

**Key changes:**

- Hardened `public.is_admin()`
- Revoked `anon EXECUTE` on admin/inventory/social/analytics definer RPCs
- Service-role-only grants for vault, webhooks, cron, queue workers
- `authenticated` execute for admin UI RPCs

**Verify:**

```bash
node scripts/verify-security-phase1-rpc-lockdown.mjs
```

---

## Phase 2 — Core RLS

**Goal:** Enable RLS on 11 flagged public tables with correct grants.

**Tables:**

- `customers`, `orders_raw`, `fulfillment_shipments` — admin authenticated only
- `product_storage`, `package_presets`, `imported_product_images` — admin only
- `stripe_webhook_events`, `shippo_webhook_events` — service_role only
- `coupon_attempt_logs`, `analytics_daily`, `inventory_issue_snapshots` — admin read; writes via service_role/RPC

**Application fixes:**

- `js/admin/customers/index.js` — uses shared `requireAdmin()`
- `js/admin/customers/api.js` — uses shared `getSupabaseClient()`

**Verify:**

```bash
node scripts/verify-security-phase2-core-rls.mjs
```

---

## Phase 3 — Security invoker views

**Goal:** Convert public views to `security_invoker = true` (PostgreSQL 15+); revoke `anon` on sensitive views; preserve storefront reads.

**Storefront views (anon SELECT retained):**

- `v_home_active_promo`, `v_home_categories`, `v_home_best_sellers`
- `v_categories_public`, `v_products_with_tags`
- `v_kk_variant_available_stock` (documented exception — remains security definer until reservations RLS is safe for invoker)

**Sensitive views:** `anon` revoked; `authenticated` + `service_role` SELECT.

**Base-table RLS added:** `products`, `categories`, `product_variants` public read policies for invoker storefront views.

**Verify:**

```bash
node scripts/verify-security-phase3-views.mjs
```

---

## Phase 4 — Policy, function, storage hardening

**Goal:** Fix permissive write policies, mutable `search_path`, public storage listing, critical anon CRUD.

**Highlights:**

- `personal_expenses` — anon CRUD removed; admin-only
- Bulk replacement of authenticated write policies using `true` → `is_admin()`
- PWA push: narrow anon insert; admin manage
- Dropped misleading PUBLIC “service role” policies on `image_blacklist`, `social_generated_images`, `stock_ledger`
- `ALTER FUNCTION … SET search_path = public` on all public functions missing it
- Removed public listing policies on storage buckets: `banners`, `looks`, `products`, `social-media`
- **Deferred:** `citext` move out of `public` (requires dependency testing)

**Verify:**

```bash
node scripts/verify-security-phase4-hardening.mjs
```

---

## Phase 5 — Final freeze

**Run all checks:**

```bash
node scripts/verify-security-phase5-final-freeze.mjs
```

This script:

1. Runs phase 1–4 verification scripts
2. SQL checks for views, RLS, RPC grants, search_path, policies, anon grants
3. Storefront anon smoke reads on public views
4. Confirms migrations and docs exist
5. Confirms no service role key in `pages/admin/settings.html`

---

## Manual Supabase dashboard tasks

Complete after deploying migrations:

1. **Rotate service role key** (required — leaked in git history)
2. **Resolve GitHub secret scanning alert** as revoked/rotated
3. **Enable leaked-password protection** — Authentication → Email → Security
4. **Re-run Supabase Security Advisor** and confirm errors/warnings cleared

Do not automate key rotation in repo code. Never commit service role keys.

---

## Acceptance criteria

| Criterion | Target |
|-----------|--------|
| `security_definer_view` errors | 0 (1 documented exception: `v_kk_variant_available_stock`) |
| `rls_disabled_in_public` on flagged tables | 0 |
| Anon-callable sensitive SECURITY DEFINER RPCs | 0 |
| Mutable `search_path` warnings | 0 (or documented) |
| Unsafe permissive authenticated write policies | 0 (push/pwa narrow inserts excepted) |
| Public storage bucket listing warnings | 0 |
| Storefront anonymous reads | Working |
| Admin workflows for admin users | Working |
| Non-admin users | Cannot read/mutate admin data |

---

## Shared utilities

- `scripts/security/securityVerifyUtils.mjs` — DB + Supabase client helpers for all phase scripts

---

## Related documentation

- [004_supabase_security_advisor_remediation.md](../audit/security/004_supabase_security_advisor_remediation.md)
- [kk_security_phase1_rpc_secret_lockdown.md](./kk_security_phase1_rpc_secret_lockdown.md)
- [002_service_role_key_remediation.md](../audit/security/002_service_role_key_remediation.md)

---

## Follow-up (post-phase 4)

- Move `citext` extension from `public` to `extensions` schema after column dependency audit
- Convert `v_kk_variant_available_stock` to invoker once safe anon RLS exists on `inventory_reservations` or a dedicated storefront stock RPC replaces it
- Tighten remaining `authenticated` **SELECT** policies that still use `USING (true)` on inventory tables (Supabase linter excludes SELECT; non-admin authenticated users may read ops data until addressed)

---

## Pre-deployment review (2026-06-18)

### Apply order

Run migrations **1 → 2 → 3 → 4 in one session** without pausing between 3 and 4. Phase 3 enables invoker views while some underlying write policies are still permissive until Phase 4 runs.

### Known residual risks after all phases

| Risk | Severity | Mitigation |
|------|----------|------------|
| Non-admin `authenticated` users may **SELECT** inventory ops tables/views (SELECT policies with `true` not in Phase 4 scope) | Medium | Follow-up migration to admin-gate SELECT on ops tables |
| `v_kk_variant_available_stock` remains **security definer** (documented exception) | Low | Accept or replace with storefront RPC |
| Storage **direct public URLs** for images should still work (public buckets); **listing** blocked | Low | Smoke-test home/product image loads after Phase 4 |
| `personal_expenses` anon CRUD removed — personal budget page must use admin login | Expected | By design |
| Service role key in git history | **Critical** | Rotate key + resolve GitHub alert (manual) |

### Patches applied during review

- Phase 3: idempotent `tags` / `product_tags` public SELECT policies (required for invoker storefront views)
- Phase 4: unique `_admin_gated` policy names (avoids failure on tables with multiple permissive write policies)
- Phase 1 verify script: correct RPC parameter names; distinguish permission denied vs validation errors
