# SMS Signup JavaScript Structure

## Current Audit

- Entry script: `pages/sms-signup.html` loads `/js/pages/sms-signup/index.js`. The previous `/js/sms-signup/index.js` path remains as a compatibility wrapper.
- Imports: navbar/footer shared modules, Supabase URL config, and page-local modules.
- DOM selectors: `phone`, `email`, `consent`, `consentText`, `btnSubmit`, `phoneError`, `formError`, `smsForm`, `smsSuccess`, `couponDisplay`, `expiryNote`, `discountLabel`, and `minOrderLabel`.
- Form handlers: submit button click runs signup; pressing Enter in the phone input also runs signup.
- Validation: phone is stripped to digits, must be 10 digits, and must start with `2-9`; consent checkbox is required. Invalid fields keep the existing shake/error behavior.
- Phone formatting: phone input formats as `(555) 123-4567` while typing and preserves cursor position.
- Consent: consent text is read from the visible `#consentText` element and sent unchanged to the subscribe function.
- Edge Function call: POST `${SUPABASE_URL}/functions/v1/sms-subscribe` with `Content-Type: application/json`; no new headers were added.
- Supabase reads/writes: none directly in the browser module. Data writes happen through the existing Edge Function.
- Coupon handling: displays `data.coupon_code`, displays `—` for `already_redeemed`, and preserves existing expiry messages for duplicate/redeemed signups.
- Duplicate signup handling: uses the existing `already_redeemed`, `already_subscribed`, `was_unsubscribed`, and `sms_sent` response flags.
- Loading/error/success states: submit button changes to `Sending…`, form errors render in `#formError`, success hides `#smsForm` and shows `#smsSuccess`.
- Analytics: no page-specific tracking call exists in this module. The page still includes `/js/shared/metaPixel.js`, which preserves the existing PageView behavior.
- Storage: stores `kk_sms_subscribed=1` and `kk_sms_contact_id` when the response includes `contact_id`; storage failures are ignored as before.
- Global functions: none exposed.

## Module Map

- `index.js` is the entry/orchestration file for shared chrome, event binding, submit flow, and localStorage persistence.
- `smsSignupState.js` stores initialization and submit-in-progress state.
- `smsSignupDom.js` centralizes selectors and safe DOM helpers.
- `smsSignupValidation.js` owns phone and consent validation.
- `smsSignupConsent.js` reads the visible consent text.
- `smsSignupApi.js` owns the `sms-subscribe` Edge Function call.
- `smsSignupCoupon.js` translates signup response flags into coupon display state.
- `smsSignupRender.js` owns loading, error, success, coupon, and START-to-resubscribe UI states.
- `smsSignupAnalytics.js` is intentionally a no-op placeholder because the current page has no page-specific analytics calls.
- `smsSignupUtils.js` contains phone formatting and normalization helpers.

## Future Changes

Keep SMS consent/coupon changes in these page modules unless the behavior is reused elsewhere. New marketing tracking should be added to `smsSignupAnalytics.js`; new response flags should be translated in `smsSignupCoupon.js` or rendered in `smsSignupRender.js`; new API fields should be built in `index.js` and sent through `smsSignupApi.js`.
