# eBay Growth Plan — $500/month

**Goal:** $500 eBay revenue per month (~36 sales at ~$14 average).
**Started:** Nov 10, 2026

---

## Where we are

| Month | eBay orders | eBay revenue |
|---|---|---|
| May | 10 | $109 |
| Jun | 9 | $153 |
| Jul | 9 | $124 |
| Aug | 17 | $270 |
| Sep | 10 | $162 |
| Oct | 7 | $112 |
| Nov (to the 10th) | 0 | $0 |

### Why sales dropped

1. **Our best sellers are gone.** The "Heads I Get Tail" challenge coins (KK-0034 and KK-0025) made ~$100/month and are now blocked from eBay. The Trader Joe's mini bag (KK-0033) made $102 in August and was removed. The plush bouquet (KK-1050) is out of stock.
2. **Commodity products lose on price.** Near-identical cat ear beanies sell for $7–11 from sellers with 17k–196k feedback. We were at $16.97 with 71 feedback. The Cat Ear Beanie got 25k impressions but only 51 views, a 0.2% click-through rate (normal is about 1% or more).
3. **Weak thumbnails.** The Cat Ear Beanie's main photo is a dark street shot where the hat is hard to see. Several listings have only one photo.
4. **Slow shipping.** Handling was 3 days, so eBay showed 4–8 day delivery.
5. **Little advertising.** Only 7 of 23 listings were promoted, at 2–5%.
6. **Out of stock while selling.** The Black Cat Beanie sold 2 in October and has 0 stock. The Fidget Chain sold 3 in August and has 0.

**What works for us:** novelty items nobody else carries (coins, the Trader Joe's bag, the plush bouquet, the 8-Ball). **What doesn't:** plain commodity items where big sellers win on price.

### What eBay's listing quality report says (Nov 9)

The report uses data from before the Nov 10 fixes, so it still shows 3-day handling, 1-photo listings and the old prices.

- **Buyers see our listings but don't click.** Hats get about 491 search impressions a day (rank 498 of 89,251 sellers), but click-through is 0.25% versus 4.9% for the top listings. Keychains: 0.18% versus 7.1%. The fixes are the thumbnail, price and title.
- **Once buyers click, we sell fine.** Conversion is 6% on keychains and 3.5% on hats.
- **Already fixed:** handling time (eBay recommends 2 days; we're now at 1), photo counts (eBay recommends 5–6), and free shipping on the 8-Ball (it was our only keychain without it).
- **Fixed after the report (Nov 10):** short titles, missing item specifics and the holiday ad rate (see "Done").

---

## Done (Nov 10)

- [x] Listed 6 new novelty items: elephant coin, koi coin, balaclava, latte charm, gummy bear charm, heart carabiner.
- [x] Promoted Listings at **8%** on every listing that has stock (20 listings; only charged when an item sells).
- [x] Handling time **3 days → 1 day** on both shipping policies.
- [x] Cat Ear Beanie (KK-0017) price **$16.97 → $13.99** (test: compare clicks and sales over 2 weeks).
- [x] New "Mix & match — buy 2+ save 10%" discount on 13 listings: bags, jewelry, coins, the new charms and the balaclava. Beanies and the older charms already had their own "buy 2+ save 10%".

- [x] 8-Ball keychain (KK_0066): $7.99 + $4.99 shipping → **$12.99 with free shipping**, Best Offer auto-accept at $10.99 (`reprice-kk0066-ebay-free-ship.mjs`).
- [x] Copied all website photos to eBay. Before → after:
  - KK_0066 8-Ball: 1 → 9
  - KK-0023 Starry Bear: 1 → 13, plus 2 per color
  - KK-0059 Yogurt Cup: 1 → 21
  - KK-0017 Cat Ear Beanie: 1 → 19
  - KK-0001 Bunny Earflap: 2 → 14
  - Also KK-0002, KK-0006, KK-0008, KK-0013 and KK-0028
- [x] KK-0016 Fuzzy Cat Ear Beanie: 5 new color photos plus an "all 5 colors" main photo, on the website and eBay.
- [x] KK-0017 Cat Ear Beanie: new white-background main photo on the website and as eBay's first photo.
- [x] Settings page eBay connection fix is live on the website.
- [x] Parcel planner tab on Admin → Parcels: plan the next order and see when it's big enough that shipping stops eating the profit.
- [x] **New titles** (eBay's top listings use 10–11 words):

  | Listing | Before | After |
  |---|---|---|
  | KK-0032 | People Pin | Funny People 1 Star Review Enamel Pin Would Not Recommend Introvert Lapel Pin |
  | KK-0028 | Brass D Ring x3 | 3 Pack Brass Screw Lock Key Ring Oval Carabiner Keychain Clip EDC Key Holder |
  | KK-0023 | Starry Bear Keychain Resin Bear Keyring Bag Charm | Starry Bear Keychain Cute Galaxy Resin Bear Keyring Kawaii Bag Charm Purse Charm |
  | KK-0039 | Red Cherry Pendant Necklace Gold-tone Rhinestone Kawaii Charm | Red Cherry Pendant Necklace Gold Tone Rhinestone Kawaii Fruit Charm Y2K Women |
  | KK-0010 | Vintage Celtic Chain Bracelet - Men's Silver-Tone Byzantine Box Clasp | Mens Celtic Chain Bracelet Stainless Steel Antique Silver Dragon Clasp Biker |

- [x] **Item specifics filled in** from the website descriptions: People Pin (type, material, color, theme), Brass key rings (color, material, carabiner clip, 3 items), Celtic bracelet (stainless steel, no stone, length per size), heart mini tote (strap material, 8 × 6 × 3 in), Starry Bear (resin and faux leather, one size), Cherry Pendant (18 in).
- [x] **Holiday ad rates** (only charged when a promoted click sells):
  - **12%:** hats (KK-0001, KK-0016) and the balaclava (KK-0070)
  - **10%:** Cat Ear Beanie (KK-0017; thin margin at $13.99) and the keychains/charms (KK_0066, KK-0008, KK-0013, KK-0023, KK-0059, KK-0071, KK-0072, KK-0073)
  - Everything else stays at 8%.
- [x] **KK-0039 Cherry Pendant was showing out of stock on eBay** even though 3 red ones are in stock. The website lists it in 3 colors but the eBay listing only sells Red, and the Blue and Green stock (0) kept overwriting the eBay quantity. Restored eBay to 3 and tied the listing to the Red variant.

Scripts: `ebay-growth-quick-wins.mjs` (ads, handling, price, discount), `sync-ebay-photos-from-site.mjs`, `set-main-photo.mjs`, `apply-ebay-listing-fixes.mjs` (titles, item specifics), `ebay-holiday-ad-rates.mjs` (all in `scripts/supabase/`).

---

## Your to-do list

### This week

- [ ] **Ship within 1 business day.** Handling is now 1 day. Late shipments hurt your seller rating, so if you can't keep up, tell me and I'll set it to 2 days.
- [ ] **Reconnect eBay so I can see traffic per listing.** The fix is live: open Admin → Settings, click **Connect eBay** again, and approve the permissions. The status should show "Connected" in green. After that I can pull impressions, click-through and conversion for every listing.

### Follow-ups

- [ ] **Dec 15: put ad rates back to 8%.** Run `node scripts/supabase/ebay-holiday-ad-rates.mjs --revert --apply`, or ask me.
- [ ] **KK-0022 Leopard Beanie: the eBay listing has ended**, even though the admin still shows it as active, so it can't be promoted. Relist it when it's restocked (it's on the restock list; only 1 Khaki left).
- [ ] **Check in 2 weeks** (with the Cat Ear Beanie price test): did click-through rise on the retitled listings and the 10–12% listings?

### Listing review: keep, fix or remove

Once analytics works, score every listing on its last 30 days:

| Signal | Means | Fix |
|---|---|---|
| Few impressions | eBay isn't showing it | Title keywords, category, item specifics |
| Impressions but click-through under 0.5% | The thumbnail or price loses in search | Main photo, price |
| Views but no sales | The listing doesn't convince | Price, photos, description, shipping speed |
| Still nothing 30 days after fixing | The product doesn't work for us | End it; sell off the stock on the website or in bundles; give the slot to a researched new item |

Candidates to look at first: KK-0028 Brass D Ring and KK-0032 People Pin (no clicks in 31 days before their Nov 10 title and item-specifics fixes) and KK-0010 men's bracelet (doesn't fit the store).
- [ ] **New photos in ChatGPT** (prompts below). Save them to `tmp/new-listings-images/<CODE>/` like last time and tell me; I'll upload them and update the listings.
  - [ ] KK-0001 Earflap Beanie (Black): the generated photo shows pointed cat ears, but the real hat has small round ears. Regenerate it with "keep the small round knob ears exactly as in the reference" before using it (saved in `tmp/new-listings-images/KK-0001/_hold-ears-dont-match/`).

To copy website photos onto eBay again later: `node scripts/supabase/sync-ebay-photos-from-site.mjs <codes> --apply`. It only adds photos, never removes them. Out-of-stock listings pick up the new photos once they're restocked.

### Restock (next parcel)

| Product | Stock now | Why | Supplier link |
|---|---|---|---|
| KK-0035 Black Cat Beanie | 0 | Sold 2 in Oct; peak hat season | [1688](https://detail.1688.com/offer/999101394164.html) |
| KK-0012 Fidget Chain | 0 (all colors) | Sold 3 in Aug | [1688](https://detail.1688.com/offer/905513419612.html) |
| KK-0022 Leopard Cat Beanie | Khaki 1, Brown 0, White 0 | Sold 2 in Oct | [1688](https://detail.1688.com/offer/967433277777.html) |
| KK-0001 Bunny Earflap Beanie | Black 2, Cream 0, Pink 0 | Sold 4 since Jun | [1688](https://detail.1688.com/offer/819604691378.html) |
| KK-0017 Cat Ear Beanie | Several colors at 0–1 | Only if the price test works | [1688](https://detail.1688.com/offer/819604691378.html) |

### Grow the catalog (the biggest lever)

- [ ] Get to **60+ active listings**. We have 23. More listings means more chances to show up in search.
- [ ] Add **10–15 novelty items per parcel**: charms, keychains, lucky coins, gift-y items that are unusual on eBay US. Avoid plain commodity items (basic beanies, basic jewelry).
- [ ] Look for compliant replacements for the coins and the Trader Joe's bag. Same buyers, but no trademarks or adult wording.
- [ ] Before buying, check eBay **sold** listings (Seller Hub → Research / Terapeak): we want items that sell several times a week at $10+ where US sellers don't dominate.

---

## ChatGPT photo prompts

Upload the current listing photo (or the 1688 supplier photo) as the reference.

**Main photo (white background):**

```text
Create a clean marketplace main product image using the attached photo as the exact reference. Show only the product on a pure white background (#FFFFFF), full item visible with no cropping, centered and filling about 85% of the frame, at a natural slight diagonal angle like a professional e-commerce flat lay. Bright, soft, even lighting with minimal natural shadow. Preserve the product's real shape, colors, materials, proportions and details exactly. Remove any watermarks, Chinese text, logos or seller marks. No text, props, hands, packaging, borders or extra objects. Square 1:1, high resolution, photorealistic.
```

**Cat Ear Beanie only:** add this line to the main prompt:

```text
Show three of the beanies side by side (black, grey and pink) so the cat ears are clearly visible from the front.
```

**One photo per color:** use the main prompt and add `Show only the [COLOR] version.`

---

## Weekly check-in

| Week of | eBay orders | eBay revenue | Notes |
|---|---|---|---|
| Nov 10 | | | Quick wins applied, 6 new listings |
| Nov 17 | | | |
| Nov 24 | | | Black Friday week |
| Dec 1 | | | |

**After 2 weeks:** check the Cat Ear Beanie. If clicks and sales are up, keep $13.99; if not, go back to $15.99 and focus on photos. Lower ad rates on anything that sells well without them.
