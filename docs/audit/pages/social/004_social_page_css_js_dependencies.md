# Social Page System — CSS & JS Dependencies

## Customer-facing social links (footer / contact / FAQ)

### CSS

| Source | Used for social? | Notes |
|--------|------------------|-------|
| Tailwind (CDN) on parent pages | Yes | Footer insert uses Tailwind utility classes (`bg-black`, `flex`, `rounded-full`, etc.) |
| `css/pages/social.css` | **No** | Does not exist |
| `css/pages/core.css` | **No** | Not used for footer icons |
| Page-specific CSS | Minimal | Contact/FAQ use page Tailwind config; icons are inline in HTML |

**Styling model:** Footer social UI is **Tailwind in HTML fragment**, not a dedicated page stylesheet.

### JavaScript

| Script | Role | Convention note |
|--------|------|-----------------|
| `js/shared/footer.js` | Loads footer insert; admin link reveal; logo 5-tap → admin login | ✅ Shared loader pattern |
| Page inline `<script type="module">` | Contact, FAQ: `initNavbar` + `initFooter` on `DOMContentLoaded` | ⚠️ Inline bootstrapping (not `js/pages/contact/index.js`) |
| Icon `<a>` tags | No click handlers | ✅ Pure navigation |

**Missing for customer social:** No `js/pages/social/` module (expected if a dedicated page is added later).

---

## Admin Social Media Manager (`/pages/admin/social.html`)

### CSS

| File | Role |
|------|------|
| CDN Tailwind + **inline** `tailwind.config` script in `<head>` | Layout, colors (`instagram`, `pinterest`, `kkpink`) |
| `/css/theme/base.css` | Base theme |
| `/css/theme/components.css` | Shared components |
| `/css/pages/admin/social.css` | Page-specific (~1k+ lines): spinners, modals, pool grid, badges |

**Convention:** Admin page CSS correctly lives under `css/pages/admin/`. Heavy use of **inline Tailwind config script** matches other admin pages but conflicts with “avoid inline scripts” preference for new work.

### JavaScript

| Entry | Role |
|-------|------|
| `/js/admin/social/index.js` (module) | Single entry; imports 10+ sibling modules |
| `js/shared/adminNav.js` | Admin nav insert |
| `js/shared/supabaseClient.js` | Auth + DB |
| `js/config/env.js` | Supabase URL/keys for OAuth redirects |
| `js/shared/pwa.js` | PWA |

**Module tree (all under `js/admin/social/`):**  
`api.js`, `calendar.js`, `uploadModal.js`, `carouselBuilder.js`, `autoQueue.js`, `autopilot.js`, `imagePool.js`, `platformSettings.js`, `postDetail.js`, `analytics.js`, `captions.js`, `postLearning.js`, `imageProcessor.js`

**Convention:** ✅ Admin JS under `js/admin/social/` (not `js/pages/` — consistent with other admin tools).

**Not loaded:** `index.js.bak` (stale backup).

### HTML structure note

`pages/admin/social.html` embeds **large amounts of markup and modals in the HTML file** itself rather than templates/inserts. That is existing admin pattern, not customer `page_inserts` style.

---

## Convention compliance summary

| Rule | Customer social links | Admin social page |
|------|----------------------|-------------------|
| Avoid inline scripts | Contact/FAQ use small inline init blocks | Inline Tailwind config in HTML |
| Page JS under `js/pages/...` | N/A (no page) | N/A (uses `js/admin/...`) |
| Page CSS under `css/pages/...` | N/A | ✅ `css/pages/admin/social.css` |
| Reusable utilities in `core.css` | Not used | Not used |
| `page_inserts` for shared chrome | ✅ Footer | ✅ Admin nav only |

---

## Service worker

`sw.js` precaches `/page_inserts/footer.html` — footer (including social icons) available offline after install; external Instagram still requires network.

---

## External dependencies

- **Tailwind CDN** — customer pages with footer, admin social page
- **Supabase client** — admin only
- **Meta Graph / Pinterest APIs** — edge functions only (server-side)
