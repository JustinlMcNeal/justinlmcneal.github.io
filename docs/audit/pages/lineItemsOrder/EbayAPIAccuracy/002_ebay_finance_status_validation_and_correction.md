# 002 — eBay Finance Status Validation & Correction

**Date**: 2026-05-11  
**Scope**: Validate the eBay profit upgrade against multiple real orders; identify and fix false-positive `estimated` ("AD FEE PENDING") status for non-promoted orders.  
**Prerequisite**: [001 audit](001_ebay_order_profit_accuracy_audit.md) + migrations v1–v3 applied.

---

## Summary

The core eBay profit upgrade (migrations v1–v3) correctly reconciles promoted listing fees, CPI cost basis, and KPI totals. However, the `estimated` finance status — which surfaces in the UI as a `≈ AD FEE PENDING` badge — was incorrectly triggering on non-promoted orders due to an overly conservative 2-day timing window.

**Root cause confirmed**: eBay Finances API generates Promoted Listing fee (`NON_SALE_CHARGE`) transactions within **4–6 minutes** of the `SALE` transaction. The v3 migration assumed a 2-day (48-hour) window, causing non-promoted orders less than 2 days old to show as pending ad fees despite no fee ever appearing.

**Fix applied** (migration v4): Window reduced from `INTERVAL '2 days'` to `INTERVAL '1 hour'`.

---

## Validation: 5 Orders Tested

### Order 1 — Promoted, complete
| Field | Value |
|---|---|
| **Order ID** | EBAY-25-14595-84685 |
| **Buyer subtotal** | $8.99 |
| **Buyer tax** | $0.00 |
| **Buyer total** | $8.99 |
| **SALE amount (eBay payout)** | $7.34 |
| **Final Value Fee (SALE-embedded)** | $1.65 (FVF $1.35 + fixed $0.30) |
| **Promoted listing fee (NON_SALE_CHARGE)** | **$1.59** (FEE-7309743735117_11, 4 min after SALE) |
| **eBay earnings** | $5.75 (= $7.34 − $1.59) |
| **Internal CPI** | $1.65 (unit $0.62 + supplier ship $1.03, 35g EUB) |
| **Shippo label** | $5.48 |
| **Net profit** | **−$1.38** |
| **Finance status (before)** | `complete` |
| **Finance status (after)** | `complete` ✓ unchanged |
| **Status correct?** | ✓ Yes |

---

### Order 2 — Non-promoted, false positive (primary fix target)
| Field | Value |
|---|---|
| **Order ID** | EBAY-27-14595-12804 |
| **Buyer subtotal** | $11.99 |
| **Buyer tax** | $0.00 |
| **Buyer total** | $11.99 |
| **SALE amount (eBay payout)** | $9.87 |
| **Final Value Fee (SALE-embedded)** | $2.12 (FVF $1.72 + fixed $0.40) |
| **Promoted listing fee (NON_SALE_CHARGE)** | **None confirmed** — no `NON_SALE_CHARGE` in Finances API after 20+ hours |
| **eBay earnings** | $9.87 (= $9.87 − $0.00) |
| **Internal CPI** | $2.90 |
| **Shippo label** | $5.40 |
| **Net profit** | **+$1.57** |
| **Finance status (before)** | `estimated` → ≈ AD FEE PENDING ✗ |
| **Finance status (after)** | `estimated_no_ad_fee` → ≈ EST ✓ |
| **Status correct?** | ✓ Yes (after fix) |

**Why it was wrong**: SALE transaction date = 2026-05-11 02:20 UTC, which is 20.4 hours before validation. The v3 migration's 48-hour window meant any order less than 2 days old triggered `estimated` regardless of whether a fee existed. Since eBay actually bills the Promoted Listing fee within minutes (not hours), 20+ hours of absence is definitive evidence the order is organic.

---

### Order 3 — Non-promoted, label purchased and synced (baseline)
| Field | Value |
|---|---|
| **Order ID** | EBAY-15-14590-70348 |
| **Buyer subtotal** | $12.59 |
| **Buyer tax** | $0.00 |
| **Buyer total** | $12.59 |
| **SALE amount (eBay payout)** | $10.37 |
| **Final Value Fee (SALE-embedded)** | $2.22 |
| **Promoted listing fee** | None (144 hours old, no NON_SALE_CHARGE) |
| **eBay earnings** | $10.37 |
| **Internal CPI** | $5.27 |
| **Shippo label** | $5.40 |
| **Net profit** | **−$0.30** |
| **Finance status (before)** | `estimated_no_ad_fee` ✓ |
| **Finance status (after)** | `estimated_no_ad_fee` ✓ unchanged |
| **Status correct?** | ✓ Yes |

---

### Order 4 — Legacy `ebay_` format, finance data absent
| Field | Value |
|---|---|
| **Order ID** | EBAY-106 |
| **stripe_checkout_session_id** | `ebay_20-14283-61628` |
| **Buyer subtotal** | $4.49 |
| **Buyer tax** | $0.39 |
| **Buyer total** | $10.77 |
| **SALE transaction** | None — legacy orders predate eBay Finances API sync window |
| **Promoted listing fee** | N/A |
| **eBay earnings** | NULL |
| **Internal CPI** | $2.21 |
| **Shippo label** | $5.89 |
| **Net profit** | NULL |
| **Finance status (before)** | `pending_finances` |
| **Finance status (after)** | `pending_finances` ✓ unchanged |
| **Status correct?** | ✓ Correct — these are orders imported before the Finance API sync was implemented. `pending_finances` accurately conveys that the ledger-side data has a label but no SALE transaction. No fix required; these orders are too old for retroactive Finances API data. |

---

### Order 5 — Promoted (second confirmed), complete
| Field | Value |
|---|---|
| **Order ID** | EBAY-05-14627-95268 |
| **Buyer subtotal** | $8.99 |
| **Buyer tax** | $0.00 |
| **Buyer total** | $8.99 |
| **SALE amount (eBay payout)** | $7.37 |
| **Final Value Fee (SALE-embedded)** | $1.62 |
| **Promoted listing fee (NON_SALE_CHARGE)** | **$1.56** (FEE-7310133650917_11, 6 min after SALE) |
| **eBay earnings** | $5.81 (= $7.37 − $1.56) |
| **Internal CPI** | $1.65 |
| **Shippo label** | $5.48 |
| **Net profit** | **−$1.32** |
| **Finance status (before)** | `complete` ✓ |
| **Finance status (after)** | `complete` ✓ unchanged |
| **Status correct?** | ✓ Yes |

---

## Root Cause: False `estimated` on Non-Promoted Orders

### Exact diagnosis

The v3 `finance_status` CASE condition for `estimated`:

```sql
-- v3 (wrong):
WHEN st.sale_amount_cents IS NOT NULL
     AND oc.total_charge_cents IS NULL
     AND st.finance_synced_at >= NOW() - INTERVAL '2 days'
     AND fs.label_cost_cents IS NOT NULL
  THEN 'estimated'
```

Any order less than 2 days old with no captured NON_SALE_CHARGE was flagged as potentially pending an ad fee. This is a blanket assumption that every fresh eBay sale might have an in-flight promoted listing fee.

### Why the assumption is wrong

eBay's Finances API creates the `NON_SALE_CHARGE` transaction for Promoted Listings fees **within minutes** of the `SALE` transaction in the same billing event:

| SALE transaction | NON_SALE_CHARGE transaction | Lag |
|---|---|---|
| 2026-05-10 17:25:00 UTC | 2026-05-10 17:29:03 UTC | **4 minutes** |
| 2026-05-10 20:37:58 UTC | 2026-05-10 20:44:09 UTC | **6 minutes** |

An order 20+ hours old with no `NON_SALE_CHARGE` in a full 90-day sync is definitively organic. The 2-day window was chosen arbitrarily in the v2/v3 migration without empirical data.

### Signal availability

eBay does not provide an explicit "was this listing promoted?" flag in the SALE transaction payload. The `marketplaceFees` array in `orderLineItems[].marketplaceFees` only contains `FINAL_VALUE_FEE` and `FINAL_VALUE_FEE_FIXED_PER_ORDER`. The Promoted Listing fee is always a separate `NON_SALE_CHARGE` transaction. Therefore, **absence of NON_SALE_CHARGE after the billing window has elapsed is the correct signal for organic status**.

---

## Revised Status Rules (v4)

The `estimated` window is reduced from `INTERVAL '2 days'` to `INTERVAL '1 hour'`.

| Status | Condition | UI Badge | Profit shown |
|---|---|---|---|
| `complete` | SALE + NON_SALE_CHARGE rows + label | _(none)_ | `ebay_net_profit_cents` (CPI basis) |
| `estimated` | SALE < 1 hour old, no NON_SALE_CHARGE, label present | `≈ AD FEE PENDING` | `—` (null, prevents overstatement) |
| `estimated_no_ad_fee` | SALE > 1 hour old, no NON_SALE_CHARGE, label present | `≈ EST` | `ebay_net_profit_cents` (CPI basis, no ad fee deducted) |
| `partial` | SALE present, no label | `≈ PARTIAL` | `—` |
| `pending_finances` | Label present, no SALE transaction | `🕐 PENDING` | `—` |
| `missing` | Neither SALE nor label | `? EBAY` | `—` |

**Rationale for 1-hour threshold**: Empirical billing lag is 4–6 minutes. 1 hour provides ~10× headroom for any eBay API delay or clock skew while remaining well below the 20+ hour window where non-promoted status is definitive.

---

## KPI Impact

The v4 fix also improves KPI profit totals. `EBAY-27-14595-12804` transitions from:

| | Before v4 | After v4 |
|---|---|---|
| `finance_status` | `estimated` | `estimated_no_ad_fee` |
| `v_order_summary_plus.profit_cents` | Fallback to `v_order_financials` (wrong: uses buyer total as revenue → ~+$2.89) | Correct: `ebay_net_profit_cents` = +$1.57 |
| UI table profit | `—` (null) | `+$1.57 ≈ EST` |

The `v_order_summary_plus` override from v3 (`profit_cents = ebay_net_profit_cents` for `complete` and `estimated_no_ad_fee`) now applies correctly to this order.

---

## Before / After: Status Summary

| Order | Before | After | Correct? |
|---|---|---|---|
| EBAY-25-14595-84685 | `complete` | `complete` | ✓ unchanged |
| EBAY-27-14595-12804 | `estimated` ✗ | `estimated_no_ad_fee` ✓ | Fixed |
| EBAY-05-14627-95268 | `complete` | `complete` | ✓ unchanged |
| EBAY-15-14590-70348 | `estimated_no_ad_fee` | `estimated_no_ad_fee` | ✓ unchanged |
| EBAY-02-14574-86309 | `estimated_no_ad_fee` | `estimated_no_ad_fee` | ✓ unchanged |
| EBAY-02-14570-96182 | `estimated_no_ad_fee` | `estimated_no_ad_fee` | ✓ unchanged |
| EBAY-23-14492-96995 | `estimated_no_ad_fee` | `estimated_no_ad_fee` | ✓ unchanged |
| EBAY-10-14490-01524 | `estimated_no_ad_fee` | `estimated_no_ad_fee` | ✓ unchanged |
| EBAY-16-14479-90027 | `estimated_no_ad_fee` | `estimated_no_ad_fee` | ✓ unchanged |
| EBAY-09-14448-58501 | `estimated_no_ad_fee` | `estimated_no_ad_fee` | ✓ unchanged |
| EBAY-106 through 109 | `pending_finances` | `pending_finances` | ✓ correct (legacy) |

---

## Files Changed

| File | Change |
|---|---|
| `supabase/migrations/20260511_ebay_finance_v4_status.sql` | New. Recreates `v_ebay_order_profit` with 1-hour billing window. Recreates `v_order_summary_plus` (CASCADE dependency). |

No JS frontend changes required. The badge and profit display logic in `renderTable.js` already handles `estimated_no_ad_fee` correctly (shows `≈ EST` badge with profit value, not null). The `estimated` → `estimated_no_ad_fee` transition is purely a view/data change.

---

## Remaining Limitations

1. **`estimated_no_ad_fee` is still an inference, not a confirmed negative**. eBay does not expose a "not promoted" flag in the Finances API. The status is correct in practice (post-billing-window absence = organic) but cannot be formally proven from API data alone.

2. **1-hour window is empirically derived from 2 data points**. If eBay ever batches Promoted Listing fees with a longer delay, a very recent sale within the first hour could be misclassified. Monitor NON_SALE_CHARGE timestamps when new promoted sales complete to validate this assumption over time.

3. **Legacy `pending_finances` orders** (EBAY-100 through EBAY-109) will never have SALE data available — the Finances API only covers recent history. These orders remain as `pending_finances` permanently and should be treated as manual-reconciliation items outside the automated profit system.

4. **`product_cost_cents = 0` on some orders** (EBAY-02-14570-96182, EBAY-23-14492-96995, others): these have `null` product match (product codes not in `products` table, likely legacy item codes). Their CPI-based profit is understated/wrong. This is a separate product-code mapping issue, not a finance status issue.
