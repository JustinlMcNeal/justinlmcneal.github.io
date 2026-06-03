# eBay Variant Listing — Operational Repair Plan

**Doc ID:** 001  
**Created:** 2026-05-17  
**Status:** Active — pending eBay restriction lift  
**Scope:** KK_0064, KK_0065, KK-0025, KK-1050  
**Type:** Documentation only — no runtime code changes in this pass

---

## 1. Summary of the Issue

Four variant-group eBay listings are showing `offer_mapping_unresolved` in the admin UI.
This means the site's local product record cannot be reconciled against active eBay child offers.

Each has a different root cause:

| Listing | Root cause |
|---|---|
| KK_0064 | 5 of 6 local variant SKUs were never pushed to eBay (only PURPLE exists on the group) |
| KK_0065 | SKU names match perfectly; 6 of 7 child offers are blocked by eBay restriction |
| KK-0025 | All offers dead; eBay group has BRONZE that was never added locally |
| KK-1050 | All offers dead; eBay group has RED that was never added locally |

---

## 2. Why This Is Not Primarily a Code Refactor Issue

The `offer_mapping_unresolved` state is correctly detected and surfaced by the link check system.
The diagnostic UI and `diagnose_group_offer_mapping` endpoint are working as designed.

The underlying problems are operational:

- **KK_0064 / KK-0025 / KK-1050:** variant SKUs on eBay do not match what the local DB expects.
  This happened because variants were added or renamed locally after the eBay push, or because the
  initial push was interrupted before all child offers were created.
- **KK_0065:** listing and SKUs are healthy; child offers are temporarily blocked by an eBay
  account restriction, not a code or data error.

No changes to `index.js`, `reconcileActions.js`, `linkCheck.js`, or any other runtime file will
fix these. The fixes are data operations (clearing stale links, adding missing local variants,
re-pushing child offers).

---

## 3. Current Restriction Warning

> **eBay account restriction is active as of 2026-05-17.**
> Estimated lift: approximately 3 days.
>
> **Do not attempt to create, push, relist, or end any eBay listings until the restriction is
> confirmed cleared.** Attempting to push during a restriction can escalate it or result in
> listings being removed immediately.
>
> The actions marked **"WAIT"** below must not be performed until the restriction is confirmed
> lifted and a fresh diagnostic re-run shows no restriction-related failure codes.

---

## 4. Per-Listing Diagnosis Table

### KK_0064 — Blue Bell Flower Charm Keychain

| Field | Value |
|---|---|
| eBay group key | `KK_0064-GROUP` |
| Stored listing ID | `377129529971` |
| Active listing | ✅ Yes — listing is live on eBay |
| Reason code | `LOCAL_VARIANT_SKU_MISMATCH` |
| Local expected SKUs | `KK_0064-BLUEGO`, `KK_0064-REDGOL`, `KK_0064-WHITEG`, `KK_0064-WHTIES`, `KK_0064-SILVER`, `KK_0064-PURPLE` |
| eBay group variant SKUs | `KK_0064-PURPLE` only |
| Found offer SKUs | `KK_0064-PURPLE` (offer qty 5, inventory qty 5) |
| Missing offer SKUs | none (the 5 others were never pushed) |
| Unavailable offer SKUs | none |
| Mismatched local SKUs | `KK_0064-BLUEGO`, `KK_0064-REDGOL`, `KK_0064-WHITEG`, `KK_0064-WHTIES`, `KK_0064-SILVER` |
| Active listing IDs | `377129529971` |

**Interpretation:** The listing is live and selling PURPLE. The other 5 color variants were never
created as eBay child offers — the eBay group only received PURPLE before the restriction hit.
The local DB expects all 6 because all 6 are active local variants.

---

### KK_0065 — Demon Slayer Keychain

| Field | Value |
|---|---|
| eBay group key | `KK_0065-GROUP` |
| Stored listing ID | `377130200759` |
| Active listing | ✅ Yes — listing is live on eBay |
| Reason code | `OFFER_NOT_AVAILABLE` |
| Local expected SKUs | `PINK`, `RED`, `WHITE`, `YELLOW`, `BLACK`, `PURPLE`, `BLUE` (all as `KK_0065-*`) |
| eBay group variant SKUs | Identical to local — perfect match ✅ |
| Found offer SKUs | `KK_0065-BLUE` (offer qty 2, inventory qty 2) |
| Missing offer SKUs | none (offers exist but 6 are unavailable) |
| Unavailable offer SKUs | `BLACK`, `RED`, `PURPLE`, `YELLOW`, `WHITE`, `PINK` |
| Mismatched local SKUs | none |
| Active listing IDs | `377130200759` |

**Interpretation:** SKU data is correct on both sides. The restriction caused 6 of 7 child offers
to become `OFFER_NOT_AVAILABLE`. BLUE is the only variant currently buyable. This should recover
automatically when the restriction is lifted — no SKU or local data changes are needed.

---

### KK-0025 — Funny Heads or Tails Challenge Coin-Silver

| Field | Value |
|---|---|
| eBay group key | `KK-0025-GROUP` |
| Stored listing ID | `377184600588` (stale) |
| Active listing | ❌ No — no active offers found |
| Reason code | `LOCAL_VARIANT_SKU_MISMATCH` |
| Local expected SKUs | `KK-0025-SILVER` |
| eBay group variant SKUs | `KK-0025-SILVER`, `KK-0025-BRONZE` |
| Found offer SKUs | none |
| Missing offer SKUs | `KK-0025-SILVER`, `KK-0025-BRONZE` |
| Unavailable offer SKUs | none |
| Mismatched local SKUs | `KK-0025-BRONZE` (on eBay group, not in local product_variants) |
| Active listing IDs | none |

**Interpretation:** The eBay group key still resolves but both child offers are gone. The stored
`ebay_listing_id` is stale — nothing is live for this product. The BRONZE variant was on the eBay
group at some point but was never added as a local variant. Safe to clear stale link once the
admin UI confirms no active listing is attached.

---

### KK-1050 — Plush Flower Bouquet

| Field | Value |
|---|---|
| eBay group key | `KK-1050-GROUP` |
| Stored listing ID | `377184526739` (stale) |
| Active listing | ❌ No — no active offers found |
| Reason code | `LOCAL_VARIANT_SKU_MISMATCH` |
| Local expected SKUs | `KK-1050-PINK` |
| eBay group variant SKUs | `KK-1050-RED`, `KK-1050-PINK` |
| Found offer SKUs | none |
| Missing offer SKUs | `KK-1050-RED`, `KK-1050-PINK` |
| Unavailable offer SKUs | none |
| Mismatched local SKUs | `KK-1050-RED` (on eBay group, not in local product_variants) |
| Active listing IDs | none |

**Interpretation:** Identical pattern to KK-0025. Group key valid, both offers gone, stored listing
ID stale. The RED variant was on the eBay group but was never added locally. Safe to clear stale
link once the admin UI confirms no active listing.

---

## 5. Actions Safe to Do Now

These actions do not require creating, ending, or relisting anything on eBay.

### KK-0025 — Clear stale local link

**Precondition:** Before clicking "Clear stale link," open the eBay admin row for KK-0025 and
confirm the diagnostic shows zero active listing IDs. The diagnostic as of 2026-05-17 shows
`activeListingIds: []`.

**Action:** Use the "Clear stale link" button in the eBay Listings admin for KK-0025.

**What this does:** Updates the local DB only — clears `ebay_offer_id`, `ebay_listing_id`,
`ebay_item_group_key`, and sets `ebay_status` to null/inactive. Does not touch eBay at all.

**What this does NOT do:** Does not end any eBay listing. Does not affect eBay inventory items.

---

### KK-1050 — Clear stale local link

**Precondition:** Same as KK-0025 — confirm `activeListingIds: []` in the diagnostic before acting.
The diagnostic as of 2026-05-17 shows `activeListingIds: []`.

**Action:** Use the "Clear stale link" button in the eBay Listings admin for KK-1050.

**Effect:** Same as above — local DB only.

---

### KK_0064 — No action now

The PURPLE variant is live and selling. Do not clear, relink, or modify anything.
Leave the stale warning visible in the admin UI as a reminder.

---

### KK_0065 — No action now

The listing is live. BLUE is selling. The `OFFER_NOT_AVAILABLE` state is restriction-caused.
Do not modify local SKUs or attempt to republish.

---

## 6. Actions to Wait On Until Restriction Clears

The following must not be performed until the restriction is confirmed lifted and a fresh
diagnostic re-run produces no restriction-related failures.

### KK_0064 — Push missing variants

After restriction clears, push the 5 missing color variants as child offers on `KK_0064-GROUP`:
- `KK_0064-BLUEGO`
- `KK_0064-REDGOL`
- `KK_0064-WHITEG`
- `KK_0064-WHTIES`
- `KK_0064-SILVER`

Do not touch the live PURPLE variant during this process.

See Section 8 for the full rebuild strategy decision.

---

### KK_0065 — Check offer recovery

After restriction clears, re-run the diagnostic. If the 6 unavailable offers auto-recover
(eBay restores them), no action is needed. If they remain `OFFER_NOT_AVAILABLE` after the
restriction lifts, treat them as missing and re-push.

---

### KK-0025 — Relist after clearing stale link

After the stale link is cleared (see Section 5) and the restriction is lifted:

Decision required: relist as SILVER-only, or add BRONZE as a local variant and relist both.
See Section 8.

---

### KK-1050 — Relist after clearing stale link

After the stale link is cleared and the restriction is lifted:

Decision required: relist as PINK-only, or add RED as a local variant and relist both.
See Section 8.

---

## 7. What Not to Do

| Action | Why forbidden |
|---|---|
| End `KK_0064` or `KK_0065` | Active listings are live and may be generating sales |
| Clear stale link for `KK_0064` or `KK_0065` | Would orphan active eBay listings from local tracking |
| Push/relist anything while restriction is active | Risk of escalating the restriction or having new listings removed |
| Edit eBay child offer quantities via the admin | Disabled by the active listing restriction |
| Change local `option_value` for KK_0065 variants | They already match eBay perfectly; changing them would break the SKU derivation |
| Add `KK-0025-BRONZE` or `KK-1050-RED` as local variants before clearing stale links | The stale group key would cause the push to fail or create a duplicate group |
| Delete any `product_variants` rows | Irreversible data loss; would break stock tracking |
| Run `clear_stale_listing_link` for KK_0064 or KK_0065 from the terminal or API | Same risk as clearing from UI — orphans a live listing |

---

## 8. Relist / Rebuild Strategy After Restriction Clears

### Step 0 — Confirm restriction is lifted

Before any push action:
1. Log in to the eBay Seller Hub.
2. Confirm no active restriction or policy violation banner.
3. Run `node test/diagnose-variant-mapping.mjs` to get a fresh baseline.

---

### KK_0064 — Add missing variants to existing live group (preferred path)

The `KK_0064-GROUP` group is live on eBay with listing `377129529971`.

**Preferred:** Push the 5 missing variants as additional child offers within the existing group.
This preserves the existing listing ID, listing history, and any views/watchers.

**Alt (only if eBay does not allow extending the group):** End the listing,
delete the group inventory item, and re-push all 6 variants as a new group.
This is destructive — only choose it if eBay's API rejects adding to the existing group.

**Pre-push checklist for KK_0064:**
- Verify `option_value` for each of the 5 missing variants in the admin variant panel.
- Confirm derived SKUs match what will be sent: `KK_0064-<UPPERCASE_6_CHAR_SUFFIX>`.
- Confirm each variant has `stock > 0`.
- Confirm images are set for each variant.

---

### KK_0065 — Wait and observe (preferred path)

Do not push or modify KK_0065 immediately after restriction lifts.
Re-run the diagnostic first. If offers auto-recovered, the listing is fully healthy.
Only push if unavailable offers are still blocked after 24 hours post-restriction.

---

### KK-0025 — Clear stale link, then decide variant scope

1. Clear stale link (Section 5 — safe to do now or anytime before restriction lifts).
2. After restriction clears, decide:
   - **SILVER-only push:** Push with the single `KK-0025-SILVER` local variant as a single-variant group. Simple, matches current local DB state.
   - **SILVER + BRONZE push:** First add `BRONZE` as an `option_value` in the KK-0025 `product_variants` table (requires confirming you physically have BRONZE stock to sell), then push both.

**Recommendation:** If BRONZE stock exists and is sellable, add it locally and push both.
If BRONZE stock is gone or uncertain, push SILVER-only to reduce risk.

---

### KK-1050 — Clear stale link, then decide variant scope

1. Clear stale link (Section 5 — safe to do now).
2. After restriction clears, decide:
   - **PINK-only push:** Push with the single `KK-1050-PINK` local variant. Matches local DB.
   - **PINK + RED push:** First add `RED` as a local variant (confirm RED bouquet stock), then push both.

**Recommendation:** Same logic as KK-0025. If RED stock is available, add and relist both.
If uncertain, push PINK-only first.

---

## 9. QA Checklist Before Making Changes

Use this checklist before any operational action on each listing.

### Before clearing a stale link (KK-0025, KK-1050)

- [ ] Open the eBay admin row for the product.
- [ ] Click "Diagnose Mapping" or run `node test/diagnose-variant-mapping.mjs`.
- [ ] Confirm `activeListingIds` is empty (`[]`).
- [ ] Confirm the stored `ebay_listing_id` does not resolve to a live eBay page
      (open `https://www.ebay.com/itm/<listing_id>` and confirm it redirects or shows "ended").
- [ ] Confirm `ebay_status` is `active` or `ended` — if active, do not clear without this check.

### Before pushing missing variants (post-restriction, KK_0064, KK-0025, KK-1050)

- [ ] Restriction confirmed lifted in eBay Seller Hub.
- [ ] Fresh diagnostic run shows no `EBAY_API_FAILURE` or `OFFER_NOT_AVAILABLE` on this product.
- [ ] All variants to be pushed have `is_active = true` in `product_variants`.
- [ ] All variants have `stock > 0`.
- [ ] Variant `option_value` spellings produce the correct eBay SKU suffix (test with `variantSkuFromOption`).
- [ ] eBay category ID is correct for the product.
- [ ] Fulfillment policy is confirmed active in seller account.

### Before re-adding a local variant row (BRONZE for KK-0025, RED for KK-1050)

- [ ] Confirm physical stock of that variant is on hand and fulfillable.
- [ ] Confirm the `option_value` you will use produces the correct SKU suffix (e.g. `BRONZE` → `KK-0025-BRONZE`).
- [ ] Stale local link cleared first — do not add a variant to a product that still has a stale `ebay_item_group_key`.

---

## 10. Rollback / Safety Notes

### Clearing a stale link is reversible in spirit but not in data

"Clear stale link" is a one-way DB update — it nulls out `ebay_offer_id`, `ebay_listing_id`,
`ebay_item_group_key`, and changes `ebay_status`. The values are not stored in a history table.

Before clearing, optionally record the values here for reference:

| Product | ebay_listing_id | ebay_item_group_key | ebay_offer_id |
|---|---|---|---|
| KK-0025 | 377184600588 | KK-0025-GROUP | (check admin before clearing) |
| KK-1050 | 377184526739 | KK-1050-GROUP | (check admin before clearing) |

If you accidentally clear a link for a product that did have an active listing, you can manually
restore the values by updating the `products` row in Supabase — no eBay API changes are needed
since "clear stale link" does not touch eBay.

### eBay inventory items (SKUs) are not affected by clearing the local link

Clearing a stale link only changes the local DB. The eBay inventory item group and any
remaining child items/offers continue to exist on eBay until you explicitly delete them.
This means if you clear the link for KK-0025 and then relist, the old group key `KK-0025-GROUP`
may already exist on eBay — the push logic must either reuse it or delete it first.

### Do not force-push over a live listing

If for any reason a product's `ebay_item_group_key` still resolves to an active eBay group
(even after clearing the local link), do not push a new listing with the same group key
without first verifying the existing group's state. Duplicate group keys will cause API errors.

---

*Diagnostic data sourced from: `node test/diagnose-variant-mapping.mjs` run on 2026-05-17.*  
*No eBay listings were created, edited, or ended in the production of this document.*
