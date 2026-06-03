# Social Page System — Current Behavior

## What users experience today

There is **no public Karry Kraze “social” or “socials” page**. Customers who want to follow the brand are sent **directly to third-party profiles** via hardcoded URLs. No Supabase data, coupons, or CTA-label flows are involved on the customer path.

### Platform URLs (consistent across footer, contact, FAQ)

| Platform | URL |
|----------|-----|
| Instagram | `https://instagram.com/karrykraze` |
| TikTok | `https://tiktok.com/@karrykraze` |
| Pinterest | `https://pinterest.com/karrykraze` |

All customer links use `target="_blank"` and `rel="noopener noreferrer"` where implemented in the footer.

---

## Entry points

### 1. Footer — Connect column (primary)

- **Where:** Injected on most storefront pages via `#kkFooterMount` + `initFooter()`.
- **What:** Three circular icon buttons (Pinterest, Instagram, TikTok).
- **Behavior:** Immediate navigation to external profile; new tab.
- **JS:** None on the icons themselves; footer loader only fetches HTML and runs admin/secret-tap logic.

### 2. Footer — Help column (admin only)

- **Link:** “Social Media” → `/pages/admin/social.html`
- **Visibility:** Hidden by default (`kk-admin-only hidden`); shown when `footer.js` confirms Supabase session + `is_admin` RPC.
- **Audience:** Admins only — not a customer social page.

### 3. Direct route — customer social page

- **Routes searched:** `/pages/social.html`, `/pages/socials.html` — **do not exist** (404 if requested).

### 4. Contact page

- **Route:** `/pages/contact.html`
- **What:** “DM Us” section with the same three icon links as the footer.
- **Behavior:** Same external destinations; inline page script calls `initNavbar()` + `initFooter()` (footer duplicates icons below main content).

### 5. FAQ page

- **Route:** `/pages/faq.html`
- **What:** Text links inside answers (restocks, sales announcements).
- **Behavior:** External Instagram / TikTok / Pinterest links; styled with `text-kkpink hover:underline`.

### 6. Navbar

- **No** social or Instagram links in `page_inserts/navbar.html`.

### 7. CTA buttons / campaign / coupon pages

- **No** dedicated social CTAs found on coupon, SMS signup, or success flows in this audit.
- **CTA label system** (`cta-label-redirect`, package inserts) targets product/review/SMS flows — **not** Instagram or a social landing page.

### 8. Admin entry (separate product)

- `/pages/admin/social.html` — full posting manager (OAuth, calendar, queue, image pool).
- Linked from admin nav, admin dashboard, and admin-only footer link.
- **Does not** use site footer (`#kkFooterMount` absent on this page).

---

## Internal page vs external Instagram

| Path | Type |
|------|------|
| Footer / Contact / FAQ social links | **External** — Instagram app/site |
| Planned `docs/todoPersonal.md` social page | **Not built** |
| Admin social manager | **Internal** — admin tooling only |

**Instagram opens directly** from customer UI today. There is no intermediate Karry Kraze landing page, tracking wrapper, or `utm_` query on footer icon clicks (UTM is used on **outbound links in scheduled social posts**, per `docs/todo.md`, not on footer icons).

---

## Broken / inconsistent items (observed, not fixed)

| Item | Notes |
|------|-------|
| Missing `pages/social.html` | Explicit todo in `docs/todoPersonal.md` |
| Footer Help → `returns.html` | Linked in footer but **page not found** in repo (separate footer issue) |
| `docs/todoPersonal.md` vs reality | Todo says “Instagram only” for future page; footer still shows TikTok + Pinterest |
| Admin `postDetail.js` | “View on Instagram” can fall back to generic `https://www.instagram.com/` when permalink missing (admin UX) |
| URL scheme | Customer links use `instagram.com`; some admin/legal links use `www.instagram.com` (usually harmless redirects) |

---

## Admin social page (brief)

For admins, `/pages/admin/social.html` is a **dynamic, Supabase-driven** application: connect Instagram/Pinterest, upload assets, schedule posts, run autopilot/auto-queue, view analytics. Content published from here appears on **external** platforms, not on the static site (except product URLs embedded in post captions with UTM params).
