# Social Page — Phase 1 Implementation

**Date:** 2026-05-19  
**Based on:** Audit docs `000`–`005` in this folder.

---

## Summary

Added a minimal public **Follow Karry Kraze** landing page at `/pages/social.html`, centralized public profile URLs in `js/shared/socialLinks.js`, and wired the shared footer with a **Follow Us** link plus `data-kk-social` href patching. Admin Social Media Manager (`/pages/admin/social.html`) was **not** modified.

---

## Files created

| File | Purpose |
|------|---------|
| `pages/social.html` | Public landing page (navbar/footer mounts, SEO meta) |
| `js/pages/social/index.js` | Renders platform cards; `initNavbar` / `initFooter` |
| `js/shared/socialLinks.js` | Single source of truth for public profile URLs |
| `css/pages/social.css` | Instagram primary card gradient polish |

---

## Files modified

| File | Change |
|------|--------|
| `page_inserts/footer.html` | **Follow Us** → `/pages/social.html`; `data-kk-social` on icon anchors |
| `js/shared/footer.js` | `applyFooterSocialLinks()` patches icon `href` from `socialLinks.js` |

---

## Behavior added

1. **`/pages/social.html`** — Branded page with headline, customer message, and three platform cards (Instagram featured first with gradient styling).
2. **Platform links** — Each card opens the external profile in a new tab (`target="_blank"`, `rel="noopener noreferrer"`).
3. **Footer** — **Follow Us** text link to the new page; existing circular icons unchanged visually; `href` values synced from shared config after footer inject.

---

## URLs / platforms included

| Platform | URL | Primary on landing page |
|----------|-----|-------------------------|
| Instagram | `https://instagram.com/karrykraze` | Yes |
| TikTok | `https://tiktok.com/@karrykraze` | No |
| Pinterest | `https://pinterest.com/karrykraze` | No |

---

## Intentionally not connected

- Supabase / auth / `social_posts` / storage / edge functions
- Admin `/pages/admin/social.html` and `js/admin/social/*`
- Analytics / Meta events for social clicks
- SMS, coupon, CTA-label flows
- Contact / FAQ duplicate URLs (left as-is per scope)

---

## Follow-up recommendations

| Priority | Item |
|----------|------|
| P2 | Point Contact / FAQ links at `socialLinks.js` (optional refactor) |
| P2 | Footer click analytics |
| P2 | Dedicated OG image for `/pages/social.html` |
| P1 | Mark `docs/todoPersonal.md` social page todo complete |
| P2 | `returns.html` footer link (separate issue) |

---

## Verification notes

- Page uses `kkNavbarMount` / `kkFooterMount` + module entry (no inline boot scripts).
- Tailwind CDN + inline `tailwind.config` matches other static pages (e.g. Contact).
- Footer icons retain fallback `href` in HTML if JS fails; `footer.js` overwrites from config when loaded.
