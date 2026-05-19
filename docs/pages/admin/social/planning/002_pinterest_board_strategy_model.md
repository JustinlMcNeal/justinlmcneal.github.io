# Pinterest Board Strategy Model (Planning)

**Date:** 2026-05-19

---

## Goal

Route Pinterest pins to boards that match **shopper search intent**, improving discovery and keeping Admin Social auto-posting aligned with performance data.

---

## Recommended board types / search intents

| Intent key | Typical shopper query angle |
|------------|----------------------------|
| `everyday-style` | Daily wear accessories |
| `gifting` | Gifts under $X, birthday gifts |
| `going-out` | Date night, party looks |
| `cute-accessories` | Aesthetic / kawaii finds |
| `seasonal` | Holiday, summer, back-to-school |
| `customer-favorites` | Best reviewed / social proof |
| `best-sellers` | Top sellers collection |
| `outfit-ideas` | How to style / complete the look |
| `product-category` | Category browse (bags, jewelry, etc.) |
| `other` | Overflow |

Align **content types** with Image Pool: `product`, `testimonial`, `promo`, `lifestyle`, `brand`, `educational`, `ugc`, `other`.

---

## Examples for Karry Kraze

- **Gifting** — testimonial + product pins; categories: gift-friendly SKUs  
- **Cute Accessories** — lifestyle + product; broad accessory categories  
- **Outfit Ideas** — product + lifestyle; apparel-adjacent categories  
- **Customer Favorites** — testimonial-heavy; high-review products  
- **Seasonal** — promo + product; time-boxed campaigns  

Start with 4–6 boards; expand from Analytics, not one board per SKU.

---

## Future AI / OpenClaw ideas (not implemented)

- Suggest new intent buckets when category performance clusters  
- Propose board names from search trend data  
- Adjust content-type weights per board from pin CTR  
- Flag stale boards (no pins 30d+) for merge/archive review  

---

## What not to automate yet

- Creating Pinterest boards via API  
- Hardcoded pin mix ratios per board  
- Cross-posting Pinterest rules to IG/FB  
- Replacing human review of brand-sensitive boards  

---

## Why boards live in Image Pool / post metadata flow

Pins need `content_type` + category context from the same pipeline as Image Pool-only auto-queue. Storing routing on `selection_metadata` keeps Instagram/Facebook untouched while enabling learnable Pinterest optimization later.

---

## Related

`docs/pages/admin/social/implementation/003_pinterest_board_strategy_routing.md`
