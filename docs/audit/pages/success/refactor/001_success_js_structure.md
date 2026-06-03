# Success Page JavaScript Structure

## Entry Point

`/js/pages/success/index.js` is the success page entry module loaded by `pages/success.html`.
`/js/success/index.js` remains as a compatibility entry that imports the new module for any older references.

## Module Map

- `successState.js` stores page initialization state, parsed URL params, and loaded order data.
- `successDom.js` centralizes DOM IDs and safe DOM helpers for showing, hiding, and updating elements.
- `successSession.js` owns checkout/order session assumptions, including `oid` handling and Stripe checkout session ID extraction.
- `successOrder.js` loads the order from `orders_raw` and line items from `line_items_raw`.
- `successCustomer.js` handles the SMS opt-in card, existing subscriber lookup, and `sms-subscribe` function call.
- `successAnalytics.js` fires the Meta Pixel purchase event and prevents duplicate purchase tracking in one page lifecycle.
- `successRender.js` renders confetti, order ID, order items, totals, savings, and shipping address.
- `successUtils.js` contains reusable formatting, escaping, phone normalization, and safe JSON helpers.

## Preserved Behavior

- `success.html` still loads a plain browser JavaScript module with no build step.
- The page still clears cart and coupon state, initializes navbar/footer, reads `oid` from the query string, renders the order ID, runs confetti, loads order details, renders order/customer details, fires purchase tracking, and initializes SMS opt-in.
- Supabase tables, selected fields, Edge Function URL, Meta Pixel payload, SMS consent text, and visible UI copy are intentionally preserved.

## Adding Future Features Safely

- Keep new page features under `js/pages/success/` unless they are genuinely shared by other pages.
- Put Supabase reads/writes in the responsibility module that owns the data, then render through `successRender.js` or a feature-specific module.
- Use `successDom.js` helpers and guard missing DOM nodes so optional UI blocks do not break the rest of the page.
- Keep `index.js` as orchestration only: initialize shared chrome, parse state, call loaders, render, and wire feature modules.
