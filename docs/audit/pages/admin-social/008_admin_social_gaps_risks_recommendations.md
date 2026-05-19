# Admin Social — Gaps, Risks & Recommendations

---

## P0 — Broken or dangerous

| ID | Issue | Detail |
|----|-------|--------|
| P0-1 | **`processing` status vs DB CHECK** | `process-scheduled-posts` sets `status: "processing"`; migrations may not allow it → publish job failures |
| P0-2 | **`posted` vs `published` mismatch** | Migration `fix_social_tables` renamed status; analytics/insights still filter `posted` |
| P0-3 | **Cron dependency** | Publishing/autopilot require Supabase cron/dashboard jobs; SQL migration notes manual setup |
| P0-4 | **OAuth/token expiry** | Expired IG token blocks all publishing; `refresh-tokens` must run on schedule |

---

## P1 — Reliability / accuracy

| ID | Issue | Detail |
|----|-------|--------|
| P1-1 | **Hardcoded Supabase URLs** | `imagePool.js`, sync boards bypass `env.js` — breaks on project change |
| P1-2 | **Monolithic HTML** | 2400+ lines — high regression risk on UI changes |
| P1-3 | **Queue tab redundancy** | Overlaps Calendar; revamp incomplete |
| P1-4 | **Alert-based UX** | Errors/success via `alert()` — easy to miss failures |
| P1-5 | **Instagram test on status card** | `testInstagramPost` prompts on production stat card |
| P1-6 | **Permalink fallback** | Generic instagram.com URL when permalink missing |
| P1-7 | **Edge functions not in config.toml** | Deploy drift for insights, oauth, ai-generate |
| P1-8 | **Autopilot over-posting** | Documented fix in todo; monitor per-day caps |

---

## P2 — Cleanup / polish

| ID | Issue | Detail |
|----|-------|--------|
| P2-1 | `js/admin/social/index.js.bak` | Unused backup |
| P2-2 | Hidden Templates tab still in DOM | OK as fallback; document only |
| P2-3 | Inline Tailwind config script | Convention mismatch with newer pages |
| P2-4 | Client-side image processing | `imageProcessor.js` notes server-side future |
| P2-5 | `generate-social-image` without UI tab | Orphan path except auto-queue |
| P2-6 | Multiple engagement/hashtag table names | `social_hashtag_analytics` vs `hashtag_performance` |

---

## Safe next implementation plan

1. **Read-only production audit** — sample `social_posts.status` distribution, last `autopilot_last_run`, cron job list.
2. **Single migration** — align status enum: allow `processing`, standardize on `posted` OR `published`, update all queries.
3. **Remove `.bak`**, centralize `SUPABASE_URL` in admin social fetches.
4. **Verify deploy** — ensure `instagram-insights`, `ai-generate`, oauth functions deployed with correct JWT settings.
5. **UI Phase 2** — merge Queue into Calendar toggle; replace test card with connection health only.

---

## Do not touch yet (risky)

| Area | Why |
|------|-----|
| `auto-queue` caption/template bulk logic | High business impact; test in staging |
| `post_learning_patterns` seed data | May reset learned behavior |
| Pinterest production OAuth switch | Requires API approval state |
| Dropping `social_variations` requirement | Many posts depend on variation FK |
| Public `social-media` bucket ACL | Breaks all live post images |

---

## Relation to public social page

Customer `/pages/social.html` is **out of scope** — no shared tables with admin posting except brand URLs in captions.
