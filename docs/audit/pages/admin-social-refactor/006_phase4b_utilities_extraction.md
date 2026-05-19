# Admin Social — Phase 4b Utilities Extraction

**Date:** 2026-05-19  
**Type:** Behavior-preserving refactor (shared pure helpers)  
**Prerequisites:** [`004_refactor_phase_plan.md`](./004_refactor_phase_plan.md), [`005_phase4b_first_refactor_prompt.md`](./005_phase4b_first_refactor_prompt.md)

---

## 1. Purpose

Extract **repeated pure helpers** into `js/admin/social/utils/` to reduce duplication and prepare for feature-folder splits (Phase 4c+). No feature modules moved; no runtime behavior intentionally changed.

---

## 2. Utility files created

| File | Exports |
|------|---------|
| `js/admin/social/utils/html.js` | `escapeHtml`, `safeText` (alias) |
| `js/admin/social/utils/formatters.js` | `formatCompactNumber`, `formatMetricNumber`, `formatPercent` |
| `js/admin/social/utils/dates.js` | `formatScheduleDate`, `formatScheduleTime` |
| `js/admin/social/utils/dom.js` | `qs`, `setText`, `setVisible` |

**Not created:** `services/edgeClient.js` (deferred to avoid call-site churn in one PR).

---

## 3. Functions extracted

### `html.js`
- **`escapeHtml`** — consolidated from `autoQueue.js`, `postDetail.js`, `scoringPerformance.js`
- Uses `&`, `<`, `>`, `"` escaping (matches auto-queue / post-detail; scoring readout previously omitted `"` — see §5)

### `formatters.js`
- **`formatCompactNumber`** — from `analytics.js` inline `formatNum` (1.2k pattern)
- **`formatMetricNumber`** — from `scoringPerformance.js` `fmtNum`
- **`formatPercent`** — from `scoringPerformance.js` `fmtPct`

### `dates.js`
- **`formatScheduleDate`** / **`formatScheduleTime`** — shared `en-US` schedule labels used in queue + auto-queue preview

### `dom.js`
- **`setText`** — from `analytics.js` duplicate inline `setEl`
- **`qs`**, **`setVisible`** — added for future use; not wired outside utils yet

---

## 4. Files updated

| File | Changes |
|------|---------|
| `js/admin/social/scoringPerformance.js` | Import `escapeHtml`, `fmtNum`/`fmtPct` aliases from utils |
| `js/admin/social/autoQueue.js` | Import `escapeHtml`, schedule date/time formatters; remove local `escapeHtml` |
| `js/admin/social/postDetail.js` | Import `escapeHtml`; remove local copy |
| `js/admin/social/analytics.js` | Import `setText`, `formatCompactNumber`; remove inline helpers |
| `js/admin/social/index.js` | Import schedule date/time for queue list rendering |

**Untouched (by design):** `postLearning.js`, `uploadModal.js`, `api.js`, `captions.js`, `pages/admin/social.html`, all edge functions.

---

## 5. Behavior preserved

| Area | Note |
|------|------|
| Analytics card numbers | Same `formatCompactNumber` logic |
| Scoring performance table | Same metric/percent formatting via aliased imports |
| Auto-queue / post detail HTML | Same escape rules (full quote escape) |
| Queue + preview schedule labels | Same `toLocaleDateString` / `toLocaleTimeString` options via `dates.js` |
| Public exports | All existing `export function` names on feature modules unchanged |

**Minor normalization:** `scoringPerformance.js` `escapeHtml` now also escapes `"` (consistent with auto-queue). Visible text in table cells is unchanged; attribute safety improved if labels ever contain quotes.

---

## 6. Helpers intentionally not extracted

| Helper | Location | Reason |
|--------|----------|--------|
| `formatScoreLabel`, `formatGuardLabel` | `autoQueue.js` | Feature-specific scoring/guard copy |
| `formatTimeForDisplay` | `postLearning.js` | Learning-only hour display |
| `formatDate` (ISO day key) | `calendar.js` | Calendar grid logic, not display label |
| `showToast` | `index.js` | Side effects + DOM creation |
| `$` / `els` map | `index.js` | Wide coupling; Phase 4f |
| `setBar` (width %) | `analytics.js` | Inline one-off |
| Analytics top-post `dateStr` | `analytics.js` | Different format (no weekday) |
| `renderBadge`, `renderEmptyState` | — | Not repeated generically |
| `formatCurrency`, `formatPlatformName` | — | Not found as shared duplicates |
| `setHTML` | — | Risky; not used |
| Hardcoded Supabase URLs | `imagePool.js`, `index.js` | Infra task, not 4b |

---

## 7. Risks

| Risk | Level | Mitigation |
|------|-------|------------|
| Import path typos | Low | Relative `./utils/*` from `js/admin/social/` |
| `escapeHtml` quote normalization in scoring | Very low | Same rendered text in cells |
| Circular imports | Low | Utils import nothing from features |
| Over-eager dom.js adoption | Low | Only `analytics.js` uses `setText` in this phase |

---

## 8. Verification

- [ ] Load `/pages/admin/social.html` — no module load errors in console
- [ ] Analytics tab — engagement cards + overview counts populate
- [ ] Analytics — scoring performance section loads
- [ ] Auto-Queue — preview list renders dates and metadata HTML
- [ ] Queue tab — scheduled date/time strings unchanged format
- [ ] Post detail — queue selection metadata renders

**Static:** ESLint not configured for this path; grep confirms no duplicate `function escapeHtml` in touched files.

---

## 9. Next recommended phase

**Phase 4c** — Split `autoQueue.js` into `features/autoQueue/*` (settings, preview, scoring UI, repost, controller) with barrel re-export at `autoQueue.js`.

Optional small follow-up before 4c: adopt `qs`/`setVisible` in one module only if it reduces noise without widening the diff.

---

## 10. Rollback

```bash
git revert <phase-4b-commit>
```

Single revert restores inline helpers in feature files and removes `utils/`.
