# Coupon QR Landing Page Implementation

Last updated: May 5, 2026

## Goal

Create a flow where admins can attach a public coupon landing page to a promotion, generate a QR code for that page, and download the QR as a PNG for physical marketing cards. Customers scan the card, land on a dedicated Karry Kraze coupon page, reveal the coupon code, copy it, and use it at checkout.

## Current Status

Status: implemented, migrated, and verified against live Supabase data. Admin browser write testing still needs an authenticated admin session.

The interrupted implementation added the public coupon page, the Supabase migration, and the admin QR controls. Follow-up verification confirmed the touched files have no VS Code diagnostics, the JavaScript parses cleanly, the public page handles missing coupon slugs gracefully, and the admin QR UI renders a production-domain QR URL and preview. The coupon landing migration was applied directly to the live Supabase database and the PostgREST schema cache was reloaded, resolving the `coupon_landing_enabled` schema cache error.

## Files Already Added Or Updated

- `pages/coupon.html` - public coupon reveal page.
- `js/coupon/index.js` - loads coupon promotion by slug, checks active/date status, renders code/details, and supports copy-to-clipboard.
- `supabase/migrations/20260505_coupon_landing_pages.sql` - adds coupon landing fields, slug constraints/indexes, optional promo codes, and public read policy support.
- `pages/admin/promotions.html` - adds QR library and Coupon page section to the admin promotion modal.
- `js/admin/promotions/modalEditor.js` - adds slug generation, production-domain coupon landing URL generation, QR preview, QR PNG download, copy URL action, validation, duplicate-slug save messaging, and save payload fields.
- `js/admin/promotions/renderTable.js` - shows QR page indicators in mobile cards and desktop rows.

## Data Model

New promotion fields:

- `coupon_landing_enabled BOOLEAN NOT NULL DEFAULT false`
- `coupon_slug TEXT`
- `coupon_page_title TEXT`
- `coupon_page_note TEXT`

Migration behavior:

- Allows `promotions.code` to be nullable so auto-applied promotions can remain code-free.
- Marks existing coded promotions as `requires_code = true` when appropriate.
- Enforces lowercase slug format with letters, numbers, and hyphens.
- Adds a unique index on `lower(coupon_slug)` when slug is present.
- Allows public select access to active public promotions and active coupon landing promotions.

## Public Coupon Page Flow

Target URL format:

```text
https://karrykraze.com/pages/coupon.html?promo=<coupon_slug>
```

Accepted query parameters in the JS:

- `promo`
- `coupon`
- `c`

Current page behavior:

- Loads navbar and footer.
- Reads the slug from the URL.
- Queries Supabase `promotions` where:
  - `coupon_slug` matches the slug.
  - `coupon_landing_enabled` is true.
  - `is_active` is true.
- Verifies the promotion is within its start/end date window.
- Requires a code before revealing the offer.
- Displays title, note/description, code, offer type, minimum order, end date, usage limit, and banner/placeholder image.
- Provides Copy, Shop Now, and Go To Checkout actions.

## Admin Promotion Flow

Current admin behavior:

- Admin opens or creates a promotion.
- Admin can check Create QR coupon page.
- Admin enters or auto-generates a slug.
- Admin can customize page title and page note.
- Admin sees a generated URL like `/pages/coupon.html?promo=<slug>`.
- On local/dev hosts, admin QR URLs intentionally use `https://karrykraze.com/pages/coupon.html?promo=<slug>` so printed QR codes point at production.
- Admin can copy the URL.
- Admin can preview the QR code.
- Admin can download a PNG named like `karry-kraze-coupon-<slug>.png`.
- Saving requires a promotion code when coupon landing is enabled.
- Saving requires a slug when coupon landing is enabled.
- Save payload includes the new coupon landing fields.

## Start-To-Finish Implementation Plan

1. Audit existing coupon and promotion system.
   - Identify checkout coupon validation modules.
   - Confirm promotions table is the source of coupon codes.
   - Confirm admin promotions page owns promotion creation/editing.

2. Add database support for coupon landing pages.
   - Add landing-enabled flag.
   - Add public slug.
   - Add optional landing page title/note.
   - Add uniqueness and slug format constraints.
   - Adjust public RLS/read policy so only explicitly enabled coupon landing promotions can be loaded publicly.

3. Build public coupon reveal page.
   - Add `pages/coupon.html`.
   - Add `js/coupon/index.js`.
   - Load promotion by slug.
   - Render code and details.
   - Handle missing, inactive, expired, and code-less coupons gracefully.

4. Extend admin promotions modal.
   - Add Coupon page section.
   - Add checkbox for QR coupon page.
   - Add slug/title/note fields.
   - Add read-only landing URL.
   - Add QR preview image.
   - Add Copy URL and Download QR PNG buttons.

5. Add QR generation.
   - Load `qrcode-generator` from CDN on admin promotions page.
   - Generate QR on canvas from the landing URL.
   - Render preview as PNG data URL.
   - Download the PNG for graphic design use.

6. Wire admin save/load behavior.
   - Load existing coupon landing values when editing.
   - Reset values when creating a new promotion.
   - Auto-generate slug from code or name until the slug is manually edited.
   - Include new fields in the save payload.
   - Validate code and slug when landing page is enabled.

7. Show QR status in the promotions list.
   - Add visible QR page indicator for mobile cards.
   - Add visible QR page and slug indicator for desktop rows.

8. Verify end to end.
   - Apply migration to Supabase.
   - Create a test promotion with a code and QR page enabled.
   - Confirm the promotion saves with slug fields.
   - Confirm QR preview appears.
   - Confirm QR PNG downloads and scans to the expected URL.
   - Confirm public coupon page loads the correct promotion.
   - Confirm copy-to-clipboard works on the public page.
   - Confirm checkout accepts the revealed code.
   - Confirm disabled/inactive/expired coupon pages show the unavailable state.

## Completed So Far

- [x] Added database migration file for coupon landing fields and policy changes.
- [x] Added public coupon landing page HTML.
- [x] Added public coupon page JavaScript.
- [x] Added admin modal UI for coupon landing pages.
- [x] Added QR library include to admin promotions page.
- [x] Added QR preview generation in admin JS.
- [x] Added QR PNG download in admin JS.
- [x] Added copy landing URL action in admin JS.
- [x] Added admin save/load/reset support for new coupon landing fields.
- [x] Added admin validation that QR coupon pages need a code and slug.
- [x] Added table/card indicators for QR-enabled promotions.
- [x] Added production-domain QR URL generation for local/admin previews.
- [x] Added clearer duplicate coupon slug save message.
- [x] Ran VS Code diagnostics on touched HTML/JS files; no errors found.
- [x] Ran `node --check` on touched JS modules; no syntax errors found.
- [x] Browser-checked public page with no slug; unavailable state renders and hides coupon code/actions/image.
- [x] Browser-checked public page with a test slug against the current database; migration is not applied yet, and the page shows a graceful unavailable state.
- [x] Browser-checked admin QR UI without saving; checkbox reveals slug/title/note/URL fields and QR preview, using a `karrykraze.com` URL.
- [x] Re-ran VS Code diagnostics for the coupon page, admin promotions page, migration tracker, and touched JS modules; no errors found.
- [x] Re-ran `node --check js/coupon/index.js; node --check js/admin/promotions/modalEditor.js`; no syntax errors found.
- [x] Re-tested local public unavailable state for missing slug.
- [x] Re-tested local public unavailable state for unknown slug; current live database still returns `42703 column promotions.coupon_slug does not exist`, and the page falls back to a friendly unavailable state.
- [x] Attempted Supabase CLI migration flow from this machine; blocked by Supabase platform permissions before the migration could be applied.
- [x] Confirmed current browser admin session is not write-authorized; Add Promotion is disabled with `Not authorized (admin only)`.
- [x] Applied `supabase/migrations/20260505_coupon_landing_pages.sql` directly to the live Supabase database using the remote Postgres connection.
- [x] Requested PostgREST schema cache reload with `NOTIFY pgrst, 'reload schema'`.
- [x] Verified live database columns: `coupon_landing_enabled`, `coupon_slug`, `coupon_page_title`, `coupon_page_note`, and nullable `code`.
- [x] Verified live indexes: `idx_promotions_coupon_landing` and `idx_promotions_coupon_slug_unique`.
- [x] Verified live slug constraint: `promotions_coupon_slug_format`.
- [x] Verified live public read policy: `public_read_active_promotions` allows active public promos or active QR landing promos.
- [x] Created/updated a temporary live QR test promotion: slug `qr-test-coupon`, code `QRTEST10`, active, QR landing enabled, and not public-listed.
- [x] Browser-tested `http://localhost:8080/pages/coupon.html?promo=qr-test-coupon`; it loads the real promo and reveals `QRTEST10`.
- [x] Browser-tested Copy on the coupon page; the copied confirmation appears.
- [x] Verified checkout coupon validation accepts `QRTEST10` through the shared coupon manager and persists the applied coupon.
- [x] Disabled the temporary `qr-test-coupon` promotion after verification so the test discount is not left active.

## Remaining Admin Browser Checks

These require an authenticated admin browser session. The current local browser session can read promotions but is not admin-write authorized, so Add Promotion is disabled and save/create cannot be tested through the admin UI here.

- In admin, create or edit a promotion with a code and QR page enabled from an authenticated admin session.
- Confirm slug auto-generation and manual slug editing both behave correctly after saving/reloading in the admin UI.
- Confirm duplicate slug save errors are understandable in the admin UI.
- Confirm Download QR PNG produces a scannable PNG from the admin UI.
- If future testing needs it, re-enable or recreate the temporary `qr-test-coupon` promotion; it was disabled after this verification pass.
- Add or update any site navigation only if a public coupon page should be discoverable outside QR links.

## Migration Runbook

Preferred path from this repo with the current Supabase CLI, if the Supabase account has project permissions:

```powershell
npx supabase link --project-ref yxdzvzscufkvewecvagq
npx supabase db push --yes
```

Initial attempted result from this VS Code session before the database password was available:

```text
Unexpected error retrieving remote project status: Your account does not have the necessary privileges to access this endpoint.
```

The migration was later applied directly through the remote Postgres connection string, then the schema cache was reloaded.

Manual fallback in the Supabase SQL editor:

1. Open the Supabase project dashboard for project ref `yxdzvzscufkvewecvagq`.
2. Open SQL Editor.
3. Paste the contents of `supabase/migrations/20260505_coupon_landing_pages.sql`.
4. Run the script.
5. Confirm the `promotions` table now has `coupon_landing_enabled`, `coupon_slug`, `coupon_page_title`, and `coupon_page_note`.

Post-migration sanity query:

```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
   and table_name = 'promotions'
   and column_name in (
      'coupon_landing_enabled',
      'coupon_slug',
      'coupon_page_title',
      'coupon_page_note',
      'code'
   )
order by column_name;
```

Expected results:

- `coupon_landing_enabled` exists and is `boolean`.
- `coupon_slug`, `coupon_page_title`, and `coupon_page_note` exist as text columns.
- `code` is nullable.

Policy sanity query:

```sql
select policyname, cmd, roles, qual
from pg_policies
where schemaname = 'public'
   and tablename = 'promotions'
   and policyname = 'public_read_active_promotions';
```

Expected result:

- The policy allows `select` for public users only when `is_active = true` and either `is_public = true` or `coupon_landing_enabled = true`.

## Live Verification Checklist

Use a temporary test promotion, then delete or disable it after testing.

Recommended test values:

- Name: `QR Test Coupon`
- Code: `QRTEST10`
- Type: percentage discount
- Value: `10`
- Minimum order: `0`
- Active: enabled
- Public: disabled unless you intentionally want it listed elsewhere
- Create QR coupon page: enabled
- URL slug: `qr-test-coupon`
- Page title: `Your QR Test Offer`
- Page note: `Use this code to test the QR coupon flow.`

Admin checks:

- Create or edit the test promotion in `pages/admin/promotions.html`.
- Enable Create QR coupon page.
- Confirm the slug auto-generates from the code or name.
- Manually edit the slug and confirm the URL updates immediately.
- Confirm the URL uses `https://karrykraze.com/pages/coupon.html?promo=<slug>`.
- Confirm Copy URL puts the same URL on the clipboard.
- Confirm the QR preview image appears.
- Download the QR PNG and scan it with a phone camera.
- Save the promotion and reload the admin page.
- Reopen the promotion and confirm all coupon page fields persisted.

Public coupon checks:

- Open `https://karrykraze.com/pages/coupon.html?promo=qr-test-coupon`.
- Confirm the page shows the custom title/note.
- Confirm the revealed code is `QRTEST10`.
- Confirm Copy works and shows a copied state.
- Confirm Shop Now opens the catalog.
- Confirm Go To Checkout opens checkout.

Checkout checks:

- Add a product to the cart.
- Open checkout.
- Paste/apply `QRTEST10`.
- Confirm the discount appears in the checkout summary.
- Do not complete payment for the test unless intentionally running a Stripe test-mode transaction.

Unavailable-state checks:

- Missing slug: `https://karrykraze.com/pages/coupon.html`
- Unknown slug: `https://karrykraze.com/pages/coupon.html?promo=missing-test-slug`
- Inactive promo: disable the test promotion and refresh the QR URL.
- Expired promo: set the end date in the past and refresh the QR URL.
- Missing code: remove the code from a QR-enabled promotion and refresh the QR URL.

Each unavailable state should show a friendly unavailable message and should not show the code panel, CTA buttons, or coupon image area.

## Acceptance Criteria

The QR coupon feature is ready to ship when all of these are true:

- Migration has been applied to Supabase without errors.
- Admin can save a QR-enabled promotion with a unique slug.
- Duplicate slugs show a clear admin-facing error.
- Admin can copy the coupon landing URL.
- Admin can download a QR PNG that scans to the production Karry Kraze coupon page.
- Public coupon URL loads the expected active promotion by slug.
- Public coupon page hides unavailable, inactive, expired, or code-less promotions.
- Checkout accepts the revealed coupon code and applies the expected discount.
- No new VS Code diagnostics appear in touched files.

Current acceptance status:

- Met: migration applied and schema cache error resolved.
- Met: live columns, indexes, constraint, and public read policy verified.
- Met: public coupon URL loads the expected active promotion by slug.
- Met: public coupon Copy action works.
- Met: checkout coupon validation accepts the revealed code while the temporary promotion is active.
- Met: no new VS Code diagnostics in touched files.
- Pending admin session: admin save, duplicate slug UI message, QR PNG download/scan from the modal.
- Review note: checkout page UI stayed on its item-loading state during a manually seeded local-cart test, but the shared coupon validation path accepted and persisted `QRTEST10` while the temporary promotion was active.

## Commit And Push Checklist

Coupon feature files expected in the feature commit:

- `docs/coupons/qrImplementation.md`
- `pages/coupon.html`
- `js/coupon/index.js`
- `supabase/migrations/20260505_coupon_landing_pages.sql`
- `pages/admin/promotions.html`
- `js/admin/promotions/modalEditor.js`
- `js/admin/promotions/renderTable.js`

Before committing, review unrelated new image assets separately. Current working tree also showed new PNG assets under `imgs/products/plushies/0050_plushFlowerBouquet/` and `imgs/stl/`; include them only if they are intentionally part of the same push.

Suggested final checks before commit:

```powershell
node --check js/coupon/index.js; node --check js/admin/promotions/modalEditor.js
git status --short
```

Suggested commit message after live verification:

```text
Add QR coupon landing pages for promotions
```

## Rollback Notes

If the migration causes an unexpected issue before launch, disable the feature without removing columns:

```sql
update public.promotions
set coupon_landing_enabled = false;
```

If a specific printed-card coupon needs to be disabled:

```sql
update public.promotions
set coupon_landing_enabled = false
where coupon_slug = 'qr-test-coupon';
```

Avoid dropping the new columns after launch unless all printed QR cards using coupon landing URLs have been retired, because removing `coupon_slug` will break those public links.

## Known Risks / Review Notes

- The public coupon page uses direct Supabase reads from `promotions`, so the RLS policy must be applied before the live page can fetch QR-enabled non-public promotions.
- The live database has applied the coupon landing migration, and the previous schema cache error is resolved.
- Supabase CLI migration was initially attempted from this machine, but the CLI account lacked privileges to link/push to project `yxdzvzscufkvewecvagq`; direct Postgres execution was used instead.
- The admin QR URL builder now forces `https://karrykraze.com` on non-production hosts so local QR previews/downloads are suitable for print.
- The QR generator is loaded from a CDN on the admin page. If the CDN fails, the admin JS shows a QR generator load error.
- `coupon_landing_enabled = true` intentionally exposes the promotion code on a public page. Admins should only enable this for codes intended to be printed/shared.
- The migration changes `promotions.code` to nullable, which matches the existing admin hint that code-less auto-applied promotions are allowed.
- Admin save/create was not completed in the local browser because the session was not admin-authorized for writes; the UI rendered, but live save must be tested from an authenticated admin session.

## Suggested Next Command/Action

Continue live verification in this order once an authenticated admin browser session is available:

1. Test admin promotion creation/editing in an authenticated admin browser session.
2. Test QR PNG download/scan from the admin modal.
3. Commit and push once verified.
