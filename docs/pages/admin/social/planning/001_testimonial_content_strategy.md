# Testimonial Content Strategy (Planning)

**Date:** 2026-05-19  
**Status:** Planning — manual-first; automation later

---

## Testimonial content goal

Use real customer reviews as high-trust social creative while keeping assets curated in the **Image Pool** so autopilot can select them with performance-based weighting (not a fixed “1 in N posts” ratio).

---

## Manual-first design exploration

1. Design 2–4 testimonial graphic templates (layout, fonts, KK logo placement, star rating, first-name-only privacy).
2. Manually compose graphics for selected reviews (Figma/Canva/etc.).
3. Upload to Image Pool → set `content_type = testimonial`.
4. Link `product_id`, set `shot_type` (e.g. `promo`), quality score, and tags as needed.
5. Mark assets autopilot-ready (product + shot_type) when satisfied.
6. Observe engagement in Admin analytics before scaling.

---

## Future generated testimonial asset workflow

1. Select review (reviews page / order review source TBD).
2. Pick base product image from Image Pool (`content_type: product`).
3. Render template: review text, rating, first name, product name, logo overlay.
4. Save output to `social_assets` with `content_type: testimonial`.
5. Optional human approval gate before `approved_for_autopilot` behavior (policy TBD).
6. Autopilot includes testimonial assets via **learnable** content-type weights from `selection_metadata` + post performance — not a hardcoded mix.

**Not implemented in reliability phase** — no generator, no OpenClaw.

---

## Recommended content types

Use `social_assets.content_type`:

| Type | Role |
|------|------|
| `product` | Default product photography |
| `testimonial` | Review graphics |
| `promo` | Promos / sales creative |
| `lifestyle` | Lifestyle shots |
| `brand` | Brand campaigns |
| `educational` | Tips / education |
| `ugc` | Customer-submitted |
| `other` | Overflow |

---

## Future OpenClaw / data-learning considerations

- OpenClaw may recommend content mix and template variants from SMS/sales/review signals — **future only**.
- Store outcomes in existing analytics + `selection_metadata` (`asset_content_type`, performance joins).
- Prefer adjusting weights from rolling engagement, not static config like `testimonial_ratio: 0.25`.

---

## Why testimonial graphics should be Image Pool assets before autopilot uses them

- Same approval, tagging, and usage tracking as product shots (`used_count`, `last_used_at`).
- Autopilot and auto-queue already resolve images from `social_assets` under pool-only policy.
- Skips and health warnings stay truthful (“no pool asset”) instead of leaking catalog fallbacks.
- Enables A/B of templates and learnable weighting without new publish pipelines.

---

## Related implementation

`docs/pages/admin/social/implementation/002_image_pool_autopilot_reliability.md`
