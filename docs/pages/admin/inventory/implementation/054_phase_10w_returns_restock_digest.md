# Phase 10W — Scheduled Returns / Restock Follow-Up Digest

**Status:** Complete  
**Depends on:** [053_phase_10v_dashboard_deeplinks_exports.md](./053_phase_10v_dashboard_deeplinks_exports.md)  
**Verification:** `node scripts/verify-inventory-phase10w-returns-restock-digest.mjs`

---

## Goal

Scheduled admin digest for returns/restocks/follow-ups so open work is not missed. **Notification/reporting only** — no stock, reservation, ledger, RMA, or channel sync mutations.

---

## 1. Digest data views

### Summary — `v_inventory_returns_restock_digest_summary`

| Field | Definition |
|-------|------------|
| `open_returns` | Open return workflows |
| `received_not_restocked` | Resellable received, not yet restocked |
| `ready_to_restock` | Restock assist ready bucket |
| `stale_observations` | Stale marketplace observations |
| `open_channel_followups` | Open post-restock follow-ups |
| `sync_review_suggested` | Informational sync review count |
| `blocked_manual_review` | Manual/blocked queue rows |
| `recent_restocks_24h` / `recent_restocks_7d` | Applied restocks |
| `recent_restocked_qty_7d` | Qty restocked (7d) |
| `overdue_followups` | Open follow-ups older than 7 days |
| `oldest_stale_observation_age_hours` | From queue summary |
| `dashboard_attention_count` | Composite attention score |

### Items — `v_inventory_returns_restock_digest_items`

Top 10 per section:

| `digest_section` | Source |
|------------------|--------|
| `ready_restock` | Worklist restock assist · `ready_to_restock` |
| `stale_observation` | Stale observation rows |
| `open_followup` | Channel follow-up rows |
| `manual_review` | Manual review / blocked assist |

---

## 2. Edge function

**Function:** `inventory-returns-restock-digest`

| Auth | Use |
|------|-----|
| Admin JWT | Preview; manual send (requires `confirm: true`) |
| `CRON_SECRET` + service role | Scheduled send |

**Body:**

```json
{ "mode": "preview" | "send", "run_type": "daily" | "weekly" | "manual", "confirm": true }
```

Behavior:

- Reads digest views only
- Builds compact text + HTML with dashboard deep links (Ready, Stale, Follow-Ups, Manual)
- Preview returns JSON — **does not log as sent**
- Send logs to `inventory_returns_restock_digest_runs`
- Email via existing **Resend** if `RESEND_API_KEY` + `RETURNS_RESTOCK_DIGEST_EMAIL_TO` set
- Duplicate daily/weekly sends blocked per schedule window (unique partial index)

---

## 3. Digest run audit

**Table:** `inventory_returns_restock_digest_runs`

Tracks: run type, schedule window, delivery channel, recipient, summary counts, status (`preview` not used for cron — preview is stateless), `sent` / `failed` / `skipped_duplicate`, timestamps, error.

---

## 4. Cron setup

**File:** `supabase/SETUP_RETURNS_RESTOCK_DIGEST_CRON.sql`

- Daily: `0 14 * * *` (adjust timezone as needed)
- Weekly: `0 14 * * 1` (Mondays)
- Requires `x-cron-secret: <CRON_SECRET>`

Secrets (optional email):

- `RESEND_API_KEY`
- `RETURNS_RESTOCK_DIGEST_EMAIL_TO`
- `RETURNS_RESTOCK_DIGEST_EMAIL_FROM` (optional)

---

## 5. Admin preview UI

**Dashboard action:** **Preview Digest**

- Opens `returnsRestockDigestPreview.js` modal
- Loads preview via edge function (no send)
- Copy text / HTML
- **Send Digest Now** — requires browser confirm + `confirm: true` on API

---

## 6. Dashboard deep links in digest

Generated from site base URL + inventory page params:

- Ready to Restock → `?returns_dashboard=1&tab=ready`
- Stale → `?returns_dashboard=1&stale_only=1`
- Follow-Ups → `?returns_dashboard=1&tab=followups`
- Manual Review → `?returns_dashboard=1&row_type=manual_review`

---

## 7. Files

| File | Role |
|------|------|
| `supabase/migrations/20261017_inventory_phase10w_returns_restock_digest.sql` | Views + runs table |
| `supabase/functions/inventory-returns-restock-digest/index.ts` | Edge function |
| `supabase/functions/_shared/returnsRestockDigestUtils.ts` | Format + fetch + email |
| `supabase/SETUP_RETURNS_RESTOCK_DIGEST_CRON.sql` | Cron template |
| `js/admin/inventory/api/returnsRestockDigestApi.js` | Admin invoke API |
| `js/admin/inventory/ui/returnsRestockDigestPreview.js` | Preview/send modal |

---

## 8. Verification results

Run: `node scripts/verify-inventory-phase10w-returns-restock-digest.mjs`

---

## 9. Limitations

- Email requires Resend secrets; without them cron send logs `failed` / manual send logs run only
- Preview is not persisted in runs table
- Digest items capped at 10 per section
- Manual send uses unique window key per invocation (no duplicate block)
- No Slack delivery in this phase

---

## 10. Recommended next phase

**Phase 10X** — implemented in [055_phase_10x_dashboard_pagination.md](./055_phase_10x_dashboard_pagination.md).  
**Phase 10Y** — Slack digest delivery parity, or reservation-grouped pagination.

---

## Related

- [052_phase_10u_returns_restock_dashboard.md](./052_phase_10u_returns_restock_dashboard.md)
- [053_phase_10v_dashboard_deeplinks_exports.md](./053_phase_10v_dashboard_deeplinks_exports.md)
