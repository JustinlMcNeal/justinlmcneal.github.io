# Pinterest Board Strategy & Routing

**Date:** 2026-05-19  
**Status:** Implemented (client + auto-queue edge; migration pending apply)

---

## Purpose

Make the Pinterest Boards tab useful for **search-intent-first** pin routing and visibility, supporting Admin Social’s goal of optimized auto-posting (assets, analytics, future learning/OpenClaw) without changing Instagram/Facebook behavior.

---

## Current board behavior (before)

| Area | Behavior |
|------|----------|
| **Storage** | `pinterest_boards` table (uuid `id`, `name`, `pinterest_board_id`, `category_id`, `is_default`) + `social_settings.pinterest_board_map` (`board_map`, `default_board_id`) |
| **Boards tab UI** | Listed boards from Pinterest API via `pinterest-boards` edge; category dropdown per board; sync via `sync-pinterest-boards` |
| **Sync** | `sync-pinterest-boards` matches/creates boards on Pinterest per **product category** and writes category→board map to settings |
| **Dropdowns** | `populateBoardDropdown` — Pinterest API ids; upload/carousel/post detail |
| **Auto-queue** | Category-only: `pinterest_board_map[category_id]` or `default_board_id`; stored on `social_posts.pinterest_board_id` (TEXT, Pinterest API id) |
| **Performance** | No per-board analytics in Boards tab; post-level data exists on `social_posts` |

**Gaps addressed:** No search intent, no content-type routing, no explicit fallback warning, API list vs DB strategy registry mismatch.

---

## Desired board strategy

- Organize by **search intent** (gift, outfit ideas, seasonal), not one-board-per-product only.
- **Recommend** new boards later; **do not** auto-create boards in this phase (note: legacy `sync-pinterest-boards` still can create on Pinterest — unchanged).
- **Default fallback board** when no mapping matches, with visible warning `no_mapped_board_found`.
- **Pinterest-only** in Boards tab; Auto-Queue/Analytics own cross-platform optimization.

---

## Search-intent-first model

`pinterest_boards.intent_key` examples: `everyday-style`, `gifting`, `going-out`, `cute-accessories`, `seasonal`, `customer-favorites`, `best-sellers`, `outfit-ideas`, `product-category`, `other`.

Routing score (auto-queue):

1. +2 if post `content_type` ∈ board `content_types`
2. +3 if product `category_id` ∈ board `mapped_category_ids` (or legacy `category_id`)
3. Best score ≥ 2 → **mapped**; else **fallback** default board; else legacy category map; else skip with `no_default_pinterest_board`

---

## Default fallback board behavior

- Admin sets **one** board `is_default` in Boards tab (`Set default`).
- Fallback uses `pinterest_boards.is_default` → else `social_settings.pinterest_board_map.default_board_id`.
- Warning in metadata: `board_routing_warning: no_mapped_board_found`.

---

## No auto-create decision

- This phase does **not** add board creation to auto-queue or new recommenders.
- `sync-pinterest-boards` behavior unchanged (still category sync / may create on Pinterest).
- `loadBoardStrategyData` upserts API boards into `pinterest_boards` **locally only** (no Pinterest POST).

---

## Files inspected

- `pages/admin/social.html` (Boards tab)
- `js/admin/social/features/boards/*`
- `js/admin/social/api.js`
- `js/admin/social/features/autoQueue/autoQueuePreview.js`
- `supabase/functions/auto-queue/index.ts`
- `supabase/functions/sync-pinterest-boards/index.ts`
- `supabase/functions/pinterest-boards/index.ts`
- `supabase/functions/pinterest-post/index.ts`
- `supabase/migrations/20260109_create_social_media_tables.sql`
- `social_posts.pinterest_board_id` (TEXT, Pinterest API id)

---

## Files changed

| File | Change |
|------|--------|
| `supabase/migrations/20260520_pinterest_board_strategy.sql` | Strategy columns |
| `supabase/functions/auto-queue/index.ts` | Intent routing + skip metadata |
| `js/admin/social/api.js` | Upsert, default, usage stats |
| `js/admin/social/features/boards/*` | Strategy UI + routing helper |
| `js/admin/social/boot/tabRouter.js` | Reload boards on tab |
| `js/admin/social/features/autoQueue/autoQueuePreview.js` | Pinterest board preview lines |
| `pages/admin/social.html` | Boards tab copy + warning |
| `js/admin/social/index.js` | `loadBoards` tab handler |
| This doc + planning doc | Documentation |

**Not changed:** `pinterest-post`, `sync-pinterest-boards`, Instagram/Facebook paths, carousel builder logic.

---

## Risks

- Migration required before strategy columns work in production.
- Edge deploy required for auto-queue routing.
- Legacy sync still creates Pinterest boards if used — operator should prefer “Sync from Pinterest” + manual strategy.
- `mapped_category_ids` empty until admin saves routing per board.

---

## Manual verification checklist

- [ ] Apply migration `20260520_pinterest_board_strategy.sql`
- [ ] Deploy `auto-queue` edge function
- [ ] Boards tab loads; warning if no default
- [ ] Edit intent, content types, categories; save routing
- [ ] Set default fallback board
- [ ] Upload/carousel/post detail board dropdowns populate
- [ ] Auto-Queue Preview with Pinterest: board metadata (mapped/fallback)
- [ ] Unmapped product → fallback + warning in metadata
- [ ] No default → Pinterest slot skipped, `no_default_pinterest_board`
- [ ] IG/FB preview unchanged
- [ ] No new automatic Pinterest board creation from auto-queue

---

## Follow-ups

- Board recommendation UI (no auto-create)
- OpenClaw intent suggestions from performance
- Deprecate or gate `sync-pinterest-boards` auto-create
- Register migration in `schema_migrations` if using tracked history
