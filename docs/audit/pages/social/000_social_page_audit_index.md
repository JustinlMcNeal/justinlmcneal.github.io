# Social Page System — Audit Index

**Audit date:** 2026-05-19  
**Scope:** Customer-facing social/socials page, footer social links, Instagram handling, and admin social media tooling.

---

## Summary

Karry Kraze has **two distinct “social” surfaces**:

1. **Customer-facing (public):** No dedicated `pages/social.html` or `pages/socials.html`. Social discovery is **static external links** (Instagram, TikTok, Pinterest) embedded in the shared footer insert, plus duplicate links on Contact and FAQ. Links open third-party profiles in a new tab.
2. **Admin-facing:** A full **Supabase-powered Social Media Manager** at `/pages/admin/social.html` for scheduling posts, OAuth, image pool, autopilot, and analytics. This is unrelated to a public “follow us” landing page.

`docs/todoPersonal.md` explicitly lists a **future** customer social page (Instagram-only) and wiring footer links to it. That page does not exist yet.

---

## Current status

| Surface | Status |
|---------|--------|
| Customer `pages/social.html` / `pages/socials.html` | **Not found** |
| Footer social icons (Connect column) | **Exists** — direct external URLs |
| Navbar social links | **None** |
| Admin `/pages/admin/social.html` | **Exists** — dynamic, Supabase-backed |
| Planned work (`docs/todoPersonal.md`) | **Documented, not implemented** |

**Overall:** **Partial implementation** — public links work as external hops; internal social landing page and unified footer strategy are missing.

---

## Documents in this folder

| File | Purpose |
|------|---------|
| [001_social_page_file_map.md](./001_social_page_file_map.md) | All files involved, grouped by type |
| [002_social_page_current_behavior.md](./002_social_page_current_behavior.md) | User-visible behavior and entry points |
| [003_social_page_pipeline.md](./003_social_page_pipeline.md) | End-to-end click and admin content flows |
| [004_social_page_css_js_dependencies.md](./004_social_page_css_js_dependencies.md) | CSS/JS dependencies and convention notes |
| [005_social_page_gaps_and_recommendations.md](./005_social_page_gaps_and_recommendations.md) | Issues, priorities, safe implementation plan |

---

## Recommended next step

1. **Decide product intent:** Internal Instagram landing page (`/pages/social.html`) vs. keep footer icons pointing straight to Instagram.
2. If building a customer page, follow project conventions: `pages/social.html`, `js/pages/social/index.js`, `css/pages/social.css`, shared navbar/footer mounts — see [005](./005_social_page_gaps_and_recommendations.md).
3. **Do not confuse** with admin revamp work in `docs/pSocial/` — that track is operational posting, not public “follow us” UX.

---

## Related docs (outside this audit)

- `docs/todoPersonal.md` — customer social page todo
- `docs/pSocial/pSocial_001.md` — admin Social Media Manager revamp plan
- `docs/todo.md` — Social Media — Full Revamp section
