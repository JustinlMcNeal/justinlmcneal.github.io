# CTA Print Action Moved to Fulfillment Tab Checkpoint

Date: 2026-05-18

## Summary

Moved the primary CTA label print action from order table rows/cards into the order workspace Fulfillment tab.

## UI Changes

- Order rows and mobile cards no longer show `Print CTA`.
- The Fulfillment tab now includes a **Packing Insert / CTA Label** section with `Print CTA Label`.
- The Labels tab remains focused on CTA label history, scan summary, and link tokens.

## Eligibility

Unchanged from the prior row-button rules:

- KK website orders with `kk_order_id`: eligible
- eBay orders: eligible
- Amazon: not eligible
- Unknown source: not eligible
- KK orders missing `kk_order_id`: not eligible with an explanatory message

## Print Flow

- Shared orchestration lives in `js/admin/lineItemsOrders/ctaPrintFlow.js`.
- The workspace button calls the same `printLabel`, `trackCtaLabelPrint`, and `createCtaLabelLink` flow as before.
- After a successful print, CTA label history refreshes when the Labels tab is open.

## Behavior Unchanged

- CTA label design
- QR redirect logic
- tracking token creation
- scan tracking
- print tracking
- coupon page destination
- KK/eBay source behavior
- shipping/Shippo behavior
- refund behavior

## Validation

- `git diff --check`
- `Get-ChildItem "js/admin/lineItemsOrders/*.js" | ForEach-Object { node --check $_.FullName }`
