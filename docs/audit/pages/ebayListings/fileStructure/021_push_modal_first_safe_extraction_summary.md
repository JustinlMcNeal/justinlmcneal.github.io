# 021 — Push Phase A: Pure Product Helpers Extraction

## Summary
Extracted three pure product helper functions from `index.js` into `utils.js` as the first safe Push-related extraction.

## What moved

| Function | Moved from → to | Type |
|---|---|---|
| `publishQuantityForProduct(product)` | `index.js` → `utils.js` | Pure function |
| `activeVariantCount(product)` | `index.js` → `utils.js` | Pure function |
| `isEffectiveGroupListing(product)` | `index.js` → `utils.js` | Pure function |

### Why these were safe
- Zero DOM interaction
- Zero module state (no `currentProduct`, `isVariantListing`, etc.)
- Zero eBay API calls
- Pure input→output: take `product` object, return a number or boolean
- Zero circular import risk (`utils.js` has no imports)

## Files changed

### `utils.js`
Added 3 exported functions at end of file under a new section header `// ── Variant / listing product helpers ────────────────────────`.

### `index.js`
- Added 3 extra named imports from `./utils.js`: `publishQuantityForProduct`, `activeVariantCount`, `isEffectiveGroupListing`
- Removed 12-line local function block (the 3 definitions)

## Call sites (unchanged behavior)

| Call site | Location | Behavior |
|---|---|---|
| `isEffectiveGroupListing(editProduct)` | line ~781, `openEdit` | Unchanged |
| `isEffectiveGroupListing(product)` | line ~1185, `doWithdraw` | Unchanged |
| `isEffectiveGroupListing(product)` | line ~1203, `doPublish` | Unchanged |
| `publishQuantityForProduct(product)` | line ~1215, `doPublish` variant path | Unchanged |
| `publishQuantityForProduct(product)` | line ~1218, `doPublish` non-variant path | Unchanged |

## Verification

| Check | Result |
|---|---|
| `node --check utils.js` | ✅ OK |
| `node --check index.js` | ✅ OK |
| Page loads | ✅ 60 products |
| Push modal opens | ✅ hydrated with product data, images, price reference, profit preview |
| Push modal closes | ✅ |
| No JS errors | ✅ |

Live eBay mutation verification (Create Item → Create Offer → Publish) was **not executed** — no code changes were made to payload construction, and these functions are not in the mutation path.

## What should move next

**Push Phase B** — Extract pure DOM helpers `addAiBadge(inputId, source)`, `imageOptionLabel(url, idx)`, and `enableBtn(id, enabled)` to `utils.js`.

- `addAiBadge`: used by both push and edit modal AI fill; zero state, zero eBay
- `imageOptionLabel`: pure string formatter; zero deps
- `enableBtn`: generic DOM state helper; zero state, zero eBay

After Phase B, proceed to **Push Phase C** (aspect helpers) per the audit in doc 020.
