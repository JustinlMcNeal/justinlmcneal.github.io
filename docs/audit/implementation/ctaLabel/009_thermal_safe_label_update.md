# CTA Label Thermal-Safe Visual Update

Date: 2026-05-18

## Summary

Updated the printed 6in x 4in CTA label design for black-and-white thermal label printers.

## Changes

- Applied a CTA-label-only logo treatment: `filter: grayscale(1) contrast(2.4);`
- Removed pink-dependent visual accents from the printed label.
- Replaced the headline accent with a black bar.
- Replaced the coupon pink shadow with a black/gray offset shadow.
- Reduced selected inner borders from 4px to 3px to keep the layout bold without making thermal output muddy.
- Preserved the 6in x 4in print size and zero page margin.

## QR And Tracking

The CTA QR remains the generated QR image from `qrcode@1` with a white background and quiet-zone padding. No CSS filter or decorative overlay is applied to the QR image.

No CTA behavior was changed:

- KK website orders still use the review CTA.
- eBay orders still use the direct channel CTA.
- Coupon codes remain `THANKYOU15` and `DIRECT15`.
- QR redirect tracking, token creation, scan tracking, print tracking, and workspace Labels tab behavior are unchanged.

## Validation

- `node --check js/admin/lineItemsOrders/*.js`
- `git diff --check`

