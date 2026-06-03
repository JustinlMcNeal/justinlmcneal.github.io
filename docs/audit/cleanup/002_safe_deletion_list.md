# Safe Deletion List

Audit date: 2026-05-17

Second-pass review was run against the files marked safe in `001_unused_file_cleanup_candidates.md`.

## Very Low Risk Delete Now

- `_patch_e3.mjs`
- `_patch_e3b.mjs`
- `_patch_full.mjs`
- `js/admin/social/index.js.bak`
- `cleanup-stale-shipments.mjs`

## Second-Pass Checks

- No active HTML `<script>` or `<link>` references were found.
- No JS/TS/MJS static imports or dynamic import strings were found.
- No CSS `url(...)` references were found.
- No `package.json` script references were found.
- Remaining references are docs-only or the file's own usage comments.
- `pages/admin/social.html` uses `/js/admin/social/index.js`, not `js/admin/social/index.js.bak`.

## Notes

- `_patch_full.mjs` is mentioned in an eBay listings audit as an over-applied historical patch attempt. The doc remains as the audit trail.
- `cleanup-stale-shipments.mjs` is documented as completed one-time cleanup work and contains a hardcoded privileged Supabase credential. Delete the file and rotate the credential if it was committed or shared.
- Medium-risk legacy import scripts and old review/CSS files remain untouched.
