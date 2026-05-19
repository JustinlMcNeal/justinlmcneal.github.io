# Admin Social — Calendar / Queue Hub Unification

**Date:** 2026-05-19  
**Type:** UI/UX behavior (no auto-queue, scoring, or publish logic changes)

---

## Purpose

Make **Calendar** the primary scheduling hub for Admin Social. The separate **Queue** tab duplicated mental model and navigation. Queue line-item management now lives inside Calendar via a view toggle. Post clicks prefer **Deep Analysis** for published posts and **Post Detail** for editable queue items.

Aligns with the product direction: optimize auto-posting using data, analytics, AI learning, and future OpenClaw integration.

---

## Files changed

| File | Change |
|------|--------|
| `pages/admin/social.html` | Queue tab button removed; hub toggle + queue list inside `#tab-calendar`; `#tab-queue` panel removed |
| `js/admin/social/boot/tabRouter.js` | `switchTab("queue")` → calendar + queue list view; queue tab loader removed from switch |
| `js/admin/social/index.js` | Wire `setupCalendarHubView`, `handlePostClick` on calendar |
| `js/admin/social/features/posts/calendarHubView.js` | **New** — Calendar vs Queue List toggle |
| `js/admin/social/features/posts/postClickRouting.js` | **New** — Deep Analysis vs Post Detail routing |
| `js/admin/social/features/posts/schedulingRefresh.js` | **New** — Refresh calendar/queue after mutations |
| `js/admin/social/features/posts/queueList.js` | Use `handlePostClick` |
| `js/admin/social/features/posts/postActions.js` | Use `refreshSchedulingHub` |
| `js/admin/social/autopilot.js` | Refresh queue when on calendar tab |
| `js/admin/social/features/autoQueue/autoQueueRepost.js` | Same |
| `docs/pages/admin/social/planning/000_docs_structure_convention.md` | **New** |
| `docs/pages/admin/social/implementation/001_calendar_queue_unification.md` | **New** (this file) |

**Not changed:** `autoQueue` scoring/settings, `api.js` queries, edge functions, Supabase schema, `calendar.js` grid logic, analytics formulas.

---

## Behavior before

- **Calendar** and **Queue** were separate top-level tabs.
- Calendar pill click → Post Detail modal.
- Queue row click → Post Detail modal.
- Analytics top posts → Deep Analysis (`openPostAnalytics`).

---

## Behavior after

### Queue tab removal

- Queue tab button is **not shown** in main nav.
- `switchTab("queue")` (e.g. after Auto-Queue generate) opens **Calendar** tab and **Queue List** sub-view.

### Calendar hub toggle

Inside **Calendar** tab header:

| Toggle | Shows |
|--------|--------|
| **Calendar** | Month grid (`#calendarHubCalendarView`) + prev/next month |
| **Queue List** | `#queueList` + `#queueFilter` (same filters as before) |

Default sub-view: **Calendar**.

### Post click routing

| Post state | Modal |
|------------|--------|
| `status === posted` (via `isPostedSuccessStatus`) | **Deep Analysis** (`openPostAnalytics`) |
| `queued`, `draft`, `failed`, `processing`, etc. | **Post Detail** (`openPostDetail`) |

**Uncertainty rule:** Non-posted statuses always use Post Detail so edit / Post Now / Delete remain available. We do not infer analytics from partial metrics on queued rows.

Applies to: calendar pills and queue list rows.

### Preserved

- Post Detail modal and all edit/post/delete flows.
- Analytics tab Deep Analysis from top posts / grid (unchanged).
- `loadQueuePosts()` filters unchanged (platform); list includes `queued` + `scheduled` statuses (excludes posted).

---

## Risks

| Risk | Mitigation |
|------|------------|
| External links/bookmarks to “queue tab” | `switchTab("queue")` redirects to calendar + queue list |
| Stale `currentTab === "queue"` in edge code | `refreshSchedulingHub` and autopilot check `calendar` too |
| Duplicate `#queueFilter` IDs | Old `#tab-queue` panel removed; single filter in calendar hub |
| Posted post on calendar without metrics yet | Still opens Deep Analysis if `status === posted` |

---

## Manual verification checklist

- [ ] Page loads with no module errors
- [ ] Default tab: **Calendar** (grid visible)
- [ ] **Queue** tab not in nav
- [ ] Toggle **Queue List** → list + platform filter work
- [ ] Toggle back to **Calendar** → grid works; month nav works
- [ ] Click **queued** post (calendar or list) → Post Detail
- [ ] Click **posted** post (calendar or list) → Deep Analysis
- [ ] Analytics top post → Deep Analysis still works
- [ ] Auto-Queue **Generate** → lands on Calendar + Queue List (not broken)
- [ ] Auto-Queue / Analytics / Image Pool / Carousel tabs still switch

---

## Related docs

- Structure convention: `docs/pages/admin/social/planning/000_docs_structure_convention.md`
- Refactor layout: `docs/audit/pages/admin-social-refactor/015_phase4_refactor_milestone_wrapup.md`
