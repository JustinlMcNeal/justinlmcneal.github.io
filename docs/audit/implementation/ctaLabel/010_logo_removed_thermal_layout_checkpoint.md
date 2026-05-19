# CTA Label Logo Removal Thermal Layout Checkpoint

Date: 2026-05-18

## Summary

Refined the 6in x 4in printed CTA label into a pure black-and-white thermal-printer layout based on the new reference direction.

## Visual Changes

- Removed the Karry Kraze logo from the printed CTA label.
- Removed the logo placeholder area and rebuilt the top row as a text-only header.
- Kept the label black-and-white only for thermal printing.
- Added a stronger right-side QR panel with a black `SCAN ME` header.
- Kept the large personalized headline, black underline, prominent coupon box, and black footer bar.
- Updated eBay label display copy/footer to emphasize shopping direct while preserving the existing eBay CTA behavior.

## Behavior

No CTA business logic was changed:

- KK website orders still use the review CTA path and `THANKYOU15`.
- eBay orders still use the direct channel CTA path and `DIRECT15`.
- QR target generation, token creation, QR redirect tracking, scan tracking, print tracking, workspace Labels tab, shipping, Shippo, and review/coupon behavior are unchanged.

## Validation

- `git diff --check`
- Expanded PowerShell equivalent for `node --check js/admin/lineItemsOrders/*.js`
- Lint check for the edited label files

