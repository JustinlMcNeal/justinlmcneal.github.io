# Social Page — Phase 1 Cleanup

**Date:** 2026-05-19  
**Follows:** [006_social_page_phase1_implementation.md](./006_social_page_phase1_implementation.md)

---

## Summary

Small cleanup: marked personal todo complete, centralized public social URL patching for Contact/FAQ/footer, and added a static loading fallback on the social landing page.

---

## Files reviewed

| File | Notes |
|------|-------|
| `docs/todoPersonal.md` | Social page todo |
| `js/shared/socialLinks.js` | Canonical URLs |
| `js/shared/footer.js` | Footer inject + link patch |
| `page_inserts/footer.html` | Follow Us + `data-kk-social` icons |
| `pages/contact.html` | DM Us icons |
| `pages/faq.html` | Inline social text links |
| `pages/social.html` | Landing page |
| `js/pages/social/index.js` | Card render |
| Audit docs `000`–`006` | Context |

**Not modified:** `pages/admin/social.html`, `js/admin/social/*`, Supabase, edge functions.

---

## Files changed

| File | Change |
|------|--------|
| `docs/todoPersonal.md` | Marked social page todo **complete** |
| `js/shared/socialLinks.js` | Added `applyPublicSocialLinks()` |
| `js/shared/footer.js` | Uses shared `applyPublicSocialLinks` (removed duplicate helper) |
| `pages/contact.html` | `data-kk-social` on icons; patch on `DOMContentLoaded` |
| `pages/faq.html` | `data-kk-social` on FAQ links; patch on `DOMContentLoaded` |
| `pages/social.html` | Static loading message + 3 pulse skeletons before JS |
| `js/pages/social/index.js` | Sets `aria-busy="false"` after cards render |

**Created:** this doc only.

---

## Todo update status

- **`docs/todoPersonal.md`** — `[x] Create a social media page` with notes pointing to `/pages/social.html`, footer Follow Us, and `socialLinks.js`.

---

## Remaining hardcoded social URLs

| Location | Why still present |
|----------|-------------------|
| `js/shared/socialLinks.js` | **Canonical source** |
| `page_inserts/footer.html` | No-JS fallback `href` on icon anchors; patched when footer loads |
| `pages/contact.html` | No-JS fallback on DM icons; patched on `DOMContentLoaded` |
| `pages/faq.html` | No-JS fallback on FAQ answer links; patched on `DOMContentLoaded` |
| Audit markdown (`002`, `003`, `006`) | Documentation only |

No other public HTML/JS files contained `instagram.com/karrykraze`, `tiktok.com/@karrykraze`, or `pinterest.com/karrykraze` after this pass (excluding admin and docs).

---

## Social page fallback / loading state

**Yes.** `pages/social.html` includes:

- Text: “Loading social links...”
- Three `animate-pulse` skeleton blocks (generic height, not full card markup)

`js/pages/social/index.js` replaces `#kkSocialPlatforms` inner HTML when the module runs and clears `aria-busy`.

---

## Recommended next phase

| Phase | Focus |
|-------|--------|
| **Phase 2 — Analytics** | Track footer Follow Us, social page views, outbound platform clicks |
| **Phase 2 — Polish** | Dedicated OG image for `/pages/social.html`; optional link to social page from FAQ copy |
| **Separate** | `returns.html` footer link; migrate Contact/FAQ inline scripts to `js/pages/*/index.js` if desired |

---

## Verification (grep)

Post-cleanup, hardcoded profile URLs in **app code** appear only in:

- `js/shared/socialLinks.js` (canonical)
- Static HTML fallbacks on footer, contact, FAQ (synced with canonical; overridden at runtime)

Admin social manager paths unchanged.
