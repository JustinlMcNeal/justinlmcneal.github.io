# Supabase Key Rotation Follow-Up

Audit date: 2026-05-17

## Summary

This pass checked local env configuration, attempted to wire the rotated Supabase service-role key into hosted Supabase secrets, and re-ran redacted repo scans.

No secret values are included in this report.

## Local `.env` Status

- `.env` is ignored by git via `.gitignore`.
- `.env` is not tracked by git.
- `SUPABASE_ANON_KEY` exists locally and decodes as Supabase `anon`.
- `SUPABASE_SERVICE_ROLE_KEY` exists locally and decodes as Supabase `service_role`.
- No Supabase key misassignment was detected.
- `SUPABASE_ANON_KEY` was not replaced or modified by this pass.

Note: the earlier state was reported as anon-key-only, but by the time this pass inspected `.env`, `SUPABASE_SERVICE_ROLE_KEY` was already present locally. No `.env` edit was required.

## Hosted Supabase Secret Update

Attempted:

```powershell
npx supabase secrets set "SUPABASE_SERVICE_ROLE_KEY=<redacted>"
```

Result:

- The Supabase CLI refused to set a secret whose name starts with `SUPABASE_`.
- A second attempt using a temporary one-key `--env-file` was also refused for the same reserved-name reason.
- `npx supabase secrets list` shows a hosted `SUPABASE_SERVICE_ROLE_KEY` entry exists, but this pass could not confirm that the hosted value was updated to match the local rotated value.

Required manual action:

- Confirm/rotate the Supabase service role key in the Supabase dashboard/project settings.
- Confirm hosted Edge Functions receive the rotated `SUPABASE_SERVICE_ROLE_KEY` through Supabase's managed environment.

## Secret Scan Result

Tracked-file redacted scan result:

```json
{
  "findings": [],
  "nonServiceJwtCount": 4,
  "nonServiceJwtRoles": ["anon"]
}
```

Additional checks:

- No tracked files contain `sb_secret_`.
- No current tracked files contain Supabase `service_role` JWTs.
- No frontend files under `pages/**/*.html` or `js/**/*.js` reference `SUPABASE_SERVICE_ROLE_KEY`.
- Frontend files only use browser-safe Supabase anon/publishable keys.
- Edge Functions read `SUPABASE_SERVICE_ROLE_KEY` from `Deno.env` only.

## Hosted Secrets List

`npx supabase secrets list` was run. It printed secret names and digests only, not secret values.

The list includes `SUPABASE_SERVICE_ROLE_KEY`, plus existing Stripe, Shippo, Twilio, eBay, OpenAI, VAPID, and related deployment secrets.

## Validation Commands Run

```powershell
node "$env:TEMP\inspect-env-redacted.cjs"
```

```powershell
git check-ignore -v ".env"; git ls-files -- ".env"; git status --short -- ".env" ".env.*"
```

```powershell
npx supabase secrets set "SUPABASE_SERVICE_ROLE_KEY=<redacted>"
```

```powershell
npx supabase secrets set --env-file <temporary-one-key-env-file>
```

```powershell
npx supabase secrets list
```

```powershell
node "$env:TEMP\precommit-tracked-secret-scan.cjs"
```

```powershell
rg "SUPABASE_SERVICE_ROLE_KEY|sb_secret_|service_role" "pages" --glob "*.html"
```

```powershell
rg "SUPABASE_SERVICE_ROLE_KEY|sb_secret_|service_role" "js" --glob "*.js"
```

```powershell
git status --short
git diff --check
```

## Flows To Retest

- Supabase Edge Functions that require service-role access, especially SMS, reviews, checkout, Shippo, eBay, push notifications, and CTA label functions.
- Cron setup SQL files after manually inserting the rotated service-role key locally at execution time.
- `pages/admin/settings.html` privileged admin actions after they are moved behind secure Edge Functions.
- Any hosted cron or deployment secret references that depend on Supabase service-role access.

## Notes

- Do not commit `.env`.
- Do not add `SUPABASE_SERVICE_ROLE_KEY` to frontend/browser code.
- Keep `SUPABASE_ANON_KEY` as the browser-safe anon key.
- The old service-role key may still exist in git history if the previous committed files were pushed or shared.
