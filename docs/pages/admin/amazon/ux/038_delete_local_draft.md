# Phase 4D — Delete Local Draft

**Prior:** [4C listing PATCH](037_listing_patch_price_qty.md)

Remove a local `amazon_listing_drafts` row from Supabase. No Amazon SP-API calls — this only clears KK-side draft state, validation issues, and retry metadata.

---

## Scope

| In scope | Out of scope |
|----------|--------------|
| Admin-only local draft delete | Amazon listing delete / retraction |
| Drafts/Issues card action | Bulk delete |
| Ready to Push card action (when draft exists) | Row menu `delete-draft` when no `draft_id` |
| Row action menu `delete-draft` (when `data-draft-id` present) | Deleting `published` or `archived` drafts |

---

## Part A — Edge function

**Function:** `amazon-delete-draft`

| Method | Auth |
|--------|------|
| `POST` | Admin JWT |

### Input

```json
{ "draftId": "uuid" }
```

### Behavior

1. Load draft row
2. Reject `published` / `archived` (`draft_not_deletable`)
3. `DELETE` from `amazon_listing_drafts`
4. Related `amazon_listing_issues` cascade via FK
5. `amazon_push_queue.draft_id` set null via FK

### Errors

| Code | Meaning |
|------|---------|
| `draft_not_found` | Bad id |
| `draft_not_deletable` | Published/archived |
| `invalid_request` | Missing/invalid UUID |
| `unauthorized` | Not admin |

---

## Part B — Shared utils

**File:** `supabase/functions/_shared/amazonDeleteDraftUtils.ts`

- `isDraftDeletableStatus`
- `deleteLocalAmazonDraft`

---

## Part C — Frontend

| File | Role |
|------|------|
| `js/admin/amazon/deleteDraft.js` | Confirm dialog, API call, refresh |
| `js/admin/amazon/api.js` | `deleteAmazonDraft()` |
| `js/admin/amazon/renderDraftsIssues.js` | Delete button on draft cards |
| `js/admin/amazon/renderReadyToPush.js` | Delete when `has_active_draft` |
| `js/admin/amazon/rowActions.js` | `delete-draft` menu item |
| `js/admin/amazon/index.js` | Wire refresh (drafts + ready-to-push) |

### Confirm copy

- **Default:** local-only delete; Amazon unchanged
- **Submitted:** extra note that Amazon listing (if accepted) is unchanged and verify metadata is removed

---

## Security

- [x] No Amazon calls from browser
- [x] Admin JWT required
- [x] Service role delete server-side only
- [x] Published drafts blocked (audit / reconciliation)

---

## Deployment

```bash
supabase functions deploy amazon-delete-draft
```

No new env vars.

---

## Known limitations

- Does not cancel in-flight Amazon submissions
- Submitted drafts can be deleted locally (operator cleanup) — use with care
- Synced tab row menu only works when row carries `data-draft-id`

---

## Recommended next phase

**5A — Live profit column**.

---

## Manual test checklist

1. Ready to Push product with saved draft → Delete → card shows Create Draft again
2. Drafts/Issues tab → Delete removes card; tab count updates
3. Submitted draft → confirm mentions Amazon unchanged; card removed
4. Attempt delete on published draft (API) → `draft_not_deletable`
5. Push modal open on deleted draft → modal closes after delete
