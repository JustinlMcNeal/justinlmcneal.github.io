# Social Page System — Gaps & Recommendations

Issues below are **documented only** — no fixes applied in this audit.

---

## Findings by priority

### P0 — Broken or misleading user-facing behavior

| ID | Issue | Detail |
|----|-------|--------|
| P0-1 | **No customer social page despite product intent** | `docs/todoPersonal.md` asks for a social media page and footer wiring; route does not exist. Users expecting `/pages/social.html` get 404. |
| P0-2 | **Footer “Returns & Refunds”** (adjacent scope) | `footer.html` links to `/pages/returns.html` which is **missing** from repo — undermines trust in footer links generally. |

*Note: Footer Instagram/TikTok/Pinterest icon URLs themselves appear valid and consistent; they are not P0 unless handles are wrong in production.*

---

### P1 — Important improvements

| ID | Issue | Detail |
|----|-------|--------|
| P1-1 | **Duplicated platform URLs** | Same three URLs copied in `footer.html`, `contact.html`, `faq.html`. Risk of drift when handle or campaign changes. |
| P1-2 | **Todo vs implementation mismatch** | Todo says future page is “Instagram only”; live footer promotes three platforms. |
| P1-3 | **No on-site social proof landing** | Reviews, SMS, and admin social engine exist; no unified “Follow us / see our latest” page for SEO or QR campaigns. |
| P1-4 | **No analytics on footer social clicks** | Unlike CTA-label or SMS flows, icon clicks are not tracked — hard to measure footer effectiveness. |
| P1-5 | **Admin post “View on Instagram” fallback** | `postDetail.js` may set generic `https://www.instagram.com/` when `instagram_permalink` absent — weak admin UX. |

---

### P2 — Cleanup / future polish

| ID | Issue | Detail |
|----|-------|--------|
| P2-1 | `js/admin/social/index.js.bak` | Unused backup; listed in cleanup audits. |
| P2-2 | Inline init scripts on Contact/FAQ | Could move to `js/pages/contact/index.js` pattern for consistency. |
| P2-3 | `www` vs non-`www` Instagram URLs | Minor inconsistency between customer and legal/admin links. |
| P2-4 | Admin social HTML size | ~2.4k lines in one file — maintainability concern (admin-only). |
| P2-5 | Duplicate social icons on Contact | Footer + contact card both show same icons. |

---

## Practical recommendations (future phase)

1. **Product decision**
   - **Option A:** Keep footer icons → external Instagram only; update `todoPersonal.md` to “won’t implement internal page.”
   - **Option B:** Add `pages/social.html` as lightweight hub (Instagram primary CTA, optional secondary links).

2. **If Option B — minimal viable page**
   - Single Instagram follow button + embed or link list.
   - Optional: latest posts via Instagram oEmbed/API (adds complexity and API keys).
   - Reuse `#kkNavbarMount` / `#kkFooterMount` + `initNavbar` / `initFooter`.
   - Centralize handle URLs in one small module (e.g. `js/shared/socialLinks.js` exporting constants).

3. **Footer wiring (per todo)**
   - Either point a new footer text link (“Follow us”) → `/pages/social.html`, or change Instagram icon `href` to internal page that meta-refreshes or prominently links out.
   - Align with “Instagram only” todo or expand todo to three platforms.

4. **Keep admin scope separate**
   - Continue admin work under `docs/pSocial/` — do not merge posting manager into customer page.

5. **URL single source of truth**
   - One config object for `karrykraze` handles used by footer insert generation or build step (optional future).

---

## Safe next implementation plan (do not implement in audit)

| Phase | Task | Risk |
|-------|------|------|
| 1 | Confirm Instagram handle and whether TikTok/Pinterest stay on customer page | Low |
| 2 | Add `pages/social.html` + `js/pages/social/index.js` + minimal `css/pages/social.css` | Low |
| 3 | Add `socialLinks.js` constants; update footer **one** Instagram entry point if desired | Medium — touch shared footer |
| 4 | Update `docs/todoPersonal.md` checkbox when done | Low |
| 5 | Optional: `returns.html` footer link fix (separate task) | Low |
| 6 | Optional: click analytics via existing analytics pattern | Medium |

**Out of scope for customer social page:** OAuth, `social_posts` table, edge functions — remain admin-only.

---

## What is already in good shape

- Footer injection pattern is clear and widely adopted.
- External social links work without backend dependency.
- Admin Social Media Manager is substantial and documented in `docs/pSocial/`.
- Service worker precaches footer for repeat visits.
