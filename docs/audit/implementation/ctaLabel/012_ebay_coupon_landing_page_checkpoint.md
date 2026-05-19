# eBay CTA Label Coupon Landing Page Checkpoint

Date: 2026-05-18

## Summary

Updated eBay CTA labels so marketplace customers scan into the direct-offer coupon landing page instead of seeing a printed promo code.

## Label Content

- eBay labels no longer print `DIRECT15`.
- eBay labels now show `UNLOCK YOUR DEAL` and `SCAN FOR 15% OFF` in the reward box.
- eBay body copy now asks customers to scan to shop direct and unlock 15% off their first website order.
- KK website review labels are unchanged: they still show review reward messaging and no `THANKYOU15` code.

## Destination

New eBay/channel CTA destination:

`https://karrykraze.com/pages/coupon.html?promo=direct15&utm_source=packing_label&utm_medium=qr&utm_campaign=ebay_direct_cta`

The coupon page reads the `promo` query parameter directly, so the additional UTM parameters do not interfere with loading the `direct15` coupon landing page. The page can reveal the promo code and show the SMS upgrade opt-in when the promotion is configured for it.

## Tracking

QR scan tracking is unchanged:

- The printed QR is still generated dynamically.
- When tracking link creation succeeds, the printed QR still points to `/r/?t=<token>`.
- The tracking link destination for new eBay labels is the coupon landing page URL above.
- CTA print tracking, token creation, scan tracking, workspace Labels tab behavior, shipping/Shippo behavior, review flow, and coupon page behavior are unchanged.

## Validation

- `git diff --check`
- `Get-ChildItem "js/admin/lineItemsOrders/*.js" | ForEach-Object { node --check $_.FullName }`
- Direct render/target checks for KK and eBay label branches
