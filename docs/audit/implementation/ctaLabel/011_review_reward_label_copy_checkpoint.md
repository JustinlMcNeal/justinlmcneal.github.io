# CTA Label Review Reward Copy Checkpoint

Date: 2026-05-18

## Summary

Updated printed CTA label copy so website orders no longer display a coupon code before the review reward exists.

## Label Content

- KK website labels still use the review CTA label type.
- KK website labels no longer show `THANKYOU15` on the printed label.
- KK website labels now show reward-unlock messaging: `UNLOCK YOUR REWARD`, `LEAVE A REVIEW`, and `GET 15% OFF`.
- eBay labels still show the direct-shopping coupon code `DIRECT15`.
- eBay labels now frame the CTA as shopping direct next time for 15% off a first website order.

## Behavior

No CTA routing, tracking, or fulfillment behavior was changed:

- KK website labels still point to the leave-review page through the existing QR/tracking flow.
- eBay labels still point to the website homepage with the existing UTM campaign through the QR/tracking flow.
- QR redirect tracking, token creation, scan tracking, print tracking, workspace Labels tab behavior, shipping/Shippo behavior, review flow, and coupon generation flow are unchanged.

## Validation

- `git diff --check`
- `Get-ChildItem "js/admin/lineItemsOrders/*.js" | ForEach-Object { node --check $_.FullName }`
