# Secret Exposure Audit

Audit date: 2026-05-17

## Summary

Security audit only. No keys were rotated, no env files were changed, and no app behavior was modified.

The main tracked-file exposure is a Supabase `service_role` JWT. It appears in multiple tracked files and also remains in `HEAD` for the recently deleted `cleanup-stale-shipments.mjs` until that deletion is committed. Treat this Supabase service role key as exposed and rotate it.

No tracked Stripe secret keys, Shippo tokens, Twilio auth tokens, Amazon secrets, OpenAI API keys, or `sb_secret_*` keys were found by the redacted scan.

The local/untracked scan found an OpenAI API key in `.env`. Because `.env` is local/untracked, this is not evidence of a committed repo exposure, but it should remain uncommitted and may need rotation if the file was shared, backed up, or otherwise exposed.

## Tracked-file findings

### Finding 1

- File: `cleanup-stale-shipments.mjs`
- Secret type: Supabase `service_role` JWT
- Redacted preview: `eyJhbGciOi...LbSw`
- Risk level: Critical
- Why it matters: This file is deleted in the working tree, but it is still present in `HEAD` until the deletion is committed. The key has full Supabase service-role privileges and bypasses RLS.
- Recommended action: Rotate the Supabase service role key. Commit the deletion. If this repository was ever pushed with this file, assume the key is compromised from git history.

### Finding 2

- File: `pages/admin/settings.html`
- Secret type: Supabase `service_role` JWT
- Redacted preview: `eyJhbGciOi...LbSw`
- Risk level: Critical
- Why it matters: A service-role key in a browser-delivered HTML file can be exposed to any user who can load that page source. Service-role credentials must never be shipped to the client.
- Recommended action: Rotate the Supabase service role key and replace this usage with a server-side/Edge Function flow or authenticated RLS-safe client behavior.

### Finding 3

- File: `supabase/SETUP_ANALYTICS_AGGREGATE_CRON.sql`
- Secret type: Supabase `service_role` JWT
- Redacted preview: `eyJhbGciOi...LbSw`
- Risk level: Critical
- Why it matters: Setup SQL files are tracked and can expose long-lived service credentials.
- Recommended action: Rotate the Supabase service role key. Replace hardcoded credentials with placeholders such as `<SUPABASE_SERVICE_ROLE_KEY>`.

### Finding 4

- File: `supabase/SETUP_EBAY_FINANCES_CRON.sql`
- Secret type: Supabase `service_role` JWT
- Redacted preview: `eyJhbGciOi...LbSw`
- Risk level: Critical
- Why it matters: Setup SQL files are tracked and can expose long-lived service credentials.
- Recommended action: Rotate the Supabase service role key. Replace hardcoded credentials with placeholders.

### Finding 5

- File: `supabase/SETUP_EBAY_SYNC_CRON.sql`
- Secret type: Supabase `service_role` JWT
- Redacted preview: `eyJhbGciOi...LbSw`
- Risk level: Critical
- Why it matters: Setup SQL files are tracked and can expose long-lived service credentials.
- Recommended action: Rotate the Supabase service role key. Replace hardcoded credentials with placeholders.

### Finding 6

- File: `supabase/SETUP_INSIGHTS_CRON.sql`
- Secret type: Supabase `service_role` JWT
- Redacted preview: `eyJhbGciOi...LbSw`
- Risk level: Critical
- Why it matters: Setup SQL files are tracked and can expose long-lived service credentials.
- Recommended action: Rotate the Supabase service role key. Replace hardcoded credentials with placeholders.

## Untracked/local findings

### Finding 1

- File: `.env`
- Secret type: OpenAI API key
- Redacted preview: `sk-proj-GD...-LoA`
- Risk level: High if shared; local-only based on this audit
- Why it matters: `.env` is a local file and was not identified as tracked, but it contains a live-looking OpenAI API key. Local env files should remain ignored and should not be pasted into logs, docs, or commits.
- Recommended action: Do not commit `.env`. Rotate this OpenAI key if the file was shared, backed up to an unsafe location, pasted into a prompt/log, or otherwise exposed.

## Rotation checklist

- Supabase service role key: Rotate now. It appears in tracked files and git history.
- OpenAI API key: Rotate if the local `.env` file was shared, committed elsewhere, synced to an unsafe backup, or exposed outside the machine.
- Stripe secret key: No tracked or local finding in this scan.
- Shippo token: No tracked or local finding in this scan.
- Twilio auth token: No tracked or local finding in this scan.
- eBay token/client secret: No hardcoded tracked or local finding in this scan.
- Amazon secret/access token: No hardcoded tracked or local finding in this scan.
- Supabase `sb_secret_*`: No finding in this scan.

## Safe findings

- `js/config/env.js` contains a Supabase anon JWT. The JWT payload role decoded as `anon`, not `service_role`.
- `js/shared/pwa.js` contains a Supabase anon JWT. The JWT payload role decoded as `anon`, not `service_role`.
- `supabase/SETUP_ABANDONED_CART_CRON.sql` contains a Supabase anon JWT, not a service-role JWT.
- `supabase/SETUP_WELCOME_SERIES_CRON.sql` contains a Supabase anon JWT, not a service-role JWT.
- `supabase/functions/pinterest-oauth/index.ts` reads `SUPABASE_SERVICE_ROLE_KEY` from `Deno.env`; this is environment-variable usage, not a hardcoded committed key.
- Many files contain Supabase project URLs or `SUPABASE_ANON_KEY` references. These are not service-role credentials.

## Validation commands run

Commands were run with redacted custom scanners so secret values were not printed.

```powershell
node "$env:TEMP\secret-scan-tracked.cjs"
```

```powershell
node "$env:TEMP\secret-scan-refined.cjs"
```

```powershell
node "$env:TEMP\secret-scan-head.cjs"
```

```powershell
node "$env:TEMP\secret-scan-local.cjs"
```

```powershell
rg "SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE|service_role" "supabase/functions/pinterest-oauth/index.ts" -C 2
```

Scanner coverage:

- Git-tracked working-tree files.
- Git `HEAD` content for tracked files, including deleted-in-working-tree files still present in the last commit.
- Common local/untracked files, including `.env`, `.env.*`, `.vscode/*.json`, and untracked files from `git ls-files --others --exclude-standard`.
- Patterns for Supabase service-role JWTs, Supabase anon JWTs, `sb_secret_*`, Stripe secret keys, OpenAI API keys, Twilio credentials, Shippo tokens, eBay/Amazon secret assignments, Bearer literals, and JWT-looking values.
