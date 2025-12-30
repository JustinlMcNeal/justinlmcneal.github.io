// /js/product/index.js
import { initNavbar } from "../shared/navbar.js";

import {
  fetchProductBySlug,
  fetchCategoryName,
  fetchVariants,
  fetchGallery,
  fetchTags,
  fetchSectionItems,
  fetchProductsByCategory,
} from "./api.js";

import {
  shippingText,
  pickMainImage,
  renderThumbGrid,
  renderThumbCarousel,
  renderTags,
  renderVariantSwatches,
  renderDetailsSections,
  renderMainCarousel,
  renderPairsCarousel,
} from "./render.js";

import { getProductPromotions } from "/js/shared/promotionLoader.js";

import { loadInsert, getProductEls, show, setActionMsg } from "./dom.js";
import { wireQtyControls, buildCartPayload, emitAddToCart } from "./cart.js";
import { renderProductPromoPanel, applyProductPriceWithPromos } from "./promos.js";

let selectedVariant = null;

/* ---------------- utils ---------------- */

function getSlugFromUrl() {
  const u = new URL(location.href);
  return (u.searchParams.get("sku") || u.searchParams.get("slug") || "")
    .trim()
    .toLowerCase();
}

function killJump(e) {
  e.preventDefault();
  e.stopPropagation();
}

/* ---------------- sticky soft dock ---------------- */

function initStickyDockFX() {
  const col = document.getElementById("stickyDetailsCol");
  if (!col) return;

  // ✅ mobile auto-disable: only run on lg+
  const mq = window.matchMedia("(min-width: 1024px)");

  let raf = null;
  let docked = false;

  function getStickyTopPx() {
    // Matches: lg:top-[calc(var(--kk-nav-h,72px)+12px)]
    const navH =
      parseFloat(
        getComputedStyle(document.documentElement)
          .getPropertyValue("--kk-nav-h")
          .trim()
      ) || 72;

    return navH + 12;
  }

  function setDocked(on) {
    if (on === docked) return;
    docked = on;
    col.classList.toggle("is-docked", docked);
  }

  function tick() {
    raf = null;

    if (!mq.matches) {
      setDocked(false);
      return;
    }

    const STICKY_TOP_PX = getStickyTopPx();
    const rect = col.getBoundingClientRect();

    // When sticky is active, top should be near STICKY_TOP_PX
    const isNowDocked = rect.top <= (STICKY_TOP_PX + 2);
    setDocked(isNowDocked);
  }

  function onScrollOrResize() {
    if (raf) return;
    raf = requestAnimationFrame(tick);
  }

  window.addEventListener("scroll", onScrollOrResize, { passive: true });
  window.addEventListener("resize", onScrollOrResize);
  mq.addEventListener?.("change", onScrollOrResize);

  tick();
}


/* ---------------- main ---------------- */

async function initProductPage() {
  // ✅ Inserts FIRST so elements exist before query
  await loadInsert("productGalleryMount", "/page_inserts/product/gallery.html");
  await loadInsert("productDetailsMount", "/page_inserts/product/details.html");

  // ✅ pairs insert mount sits under Details in details.html:
  // <div id="productPairsMount" class="mt-10"></div>
  await loadInsert("productPairsMount", "/page_inserts/product/pairs.html");

  // ✅ now that DOM exists, wire soft dock + collect els
  initStickyDockFX();

  const els = getProductEls();
  wireQtyControls(els);

  const slug = getSlugFromUrl();

  if (!slug) {
    show(els.loading, false);
    show(els.error, true);
    if (els.errorMsg) {
      els.errorMsg.textContent =
        "Missing product slug. Go back to the catalog and select an item.";
    }
    return;
  }

  try {
    show(els.loading, true);
    show(els.error, false);
    show(els.wrap, false);
    setActionMsg(els, "");

    // Fetch main product
    const product = await fetchProductBySlug(slug);

    // Parallel fetches
    const [categoryName, variants, gallery, tags, sections] = await Promise.all([
      fetchCategoryName(product.category_id),
      fetchVariants(product.id),
      fetchGallery(product.id),
      fetchTags(product.id),
      fetchSectionItems(product.id),
    ]);

    // Title/header bits (if present)
    document.title = `KARRY KRAZE — ${product.name}`;
    if (els.crumbName) els.crumbName.textContent = product.name || "Product";
    if (els.category) els.category.textContent = categoryName || "Karry Kraze";
    if (els.name) els.name.textContent = product.name || "";
    if (els.code) els.code.textContent = product.code ? `Code: ${product.code}` : "";

    // Promotions (auto promos only)
    const promos = await getProductPromotions(
      product.id,
      product.category_id ? [product.category_id] : [],
      (tags || []).map((t) => t.id).filter(Boolean)
    );

    // Price (uses same logic as cart, via promos.js)
    const base = Number(product.price || 0);
    applyProductPriceWithPromos(els.price, base, promos);

    // Shipping under price
    if (els.shipping) els.shipping.textContent = shippingText(product.shipping_status);

    // Promo breakdown dropdown panel
    renderProductPromoPanel(els, promos, base);

    // Gallery images (dedup)
    const imgUrls = [
      product.catalog_image_url,
      product.primary_image_url,
      ...(gallery || []).map((g) => g.url),
      ...(variants || []).map((v) => v.preview_image_url).filter(Boolean),
    ].filter(Boolean);

    const uniqueImgs = [...new Set(imgUrls)];
    if (!uniqueImgs.length) uniqueImgs.push(pickMainImage(product, gallery, variants));

    // Main carousel + thumbs sync
    let thumbsM = null;
    let thumbsD = null;

    const carousel = renderMainCarousel(els.carousel, uniqueImgs, (idx) => {
      thumbsM?.setActive(idx);
      thumbsD?.setActive(idx);
    });

    thumbsM = renderThumbCarousel(els.thumbCarousel, uniqueImgs, (_u, idx) => {
      carousel?.setIndex(idx);
      thumbsM?.setActive(idx);
      thumbsD?.setActive(idx);
    });

    thumbsD = renderThumbGrid(els.thumbRow, uniqueImgs, (_u, idx) => {
      carousel?.setIndex(idx);
      thumbsM?.setActive(idx);
      thumbsD?.setActive(idx);
    });

    // Arrow buttons
    if (els.prev) {
      els.prev.addEventListener("pointerdown", killJump, { passive: false });
      els.prev.addEventListener(
        "click",
        (e) => {
          killJump(e);
          carousel?.prev();
        },
        { passive: false }
      );
    }
    if (els.next) {
      els.next.addEventListener("pointerdown", killJump, { passive: false });
      els.next.addEventListener(
        "click",
        (e) => {
          killJump(e);
          carousel?.next();
        },
        { passive: false }
      );
    }

    // Tags
    renderTags(els.tagRow, (tags || []).map((t) => t.name));

    // Variants (color boxes)
    renderVariantSwatches(els.variantSwatches, variants, (v) => {
      selectedVariant = v || null;

      // jump to matching variant image
      if (v?.preview_image_url) {
        const idx = uniqueImgs.indexOf(v.preview_image_url);
        if (idx >= 0) {
          carousel?.setIndex(idx);
          thumbsM?.setActive(idx);
          thumbsD?.setActive(idx);
        }
      }
    });

    // Details accordions
    renderDetailsSections(els.details, sections);

    // Add to cart
    if (els.addBtn) {
      els.addBtn.onclick = () => {
        const payload = buildCartPayload(els, product, tags, selectedVariant);
        emitAddToCart(payload);
        setActionMsg(els, "Added to cart.");
      };
    }

    // ✅ Pairs well with (same category carousel)
    try {
      const paired = await fetchProductsByCategory(product.category_id, {
        excludeId: product.id,
        limit: 12,
      });

      if (els.pairsWrap && els.pairsCarousel) {
        if (paired.length) {
          renderPairsCarousel(els.pairsCarousel, paired);
        } else {
          els.pairsCarousel.innerHTML = `
            <div class="text-sm opacity-70">
              No recommendations yet for this category.
            </div>
          `;
        }
        els.pairsWrap.classList.remove("hidden");
      }
    } catch (e) {
      console.warn("Pairs well with failed:", e);

      if (els.pairsWrap && els.pairsCarousel) {
        els.pairsCarousel.innerHTML = `
          <div class="text-sm opacity-70">
            Couldn’t load recommendations.
          </div>
        `;
        els.pairsWrap.classList.remove("hidden");
      }
    }

    show(els.loading, false);
    show(els.wrap, true);
  } catch (err) {
    console.error(err);
    show(els.loading, false);
    show(els.error, true);
    if (els.errorMsg) els.errorMsg.textContent = err?.message || String(err);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  initNavbar();
  initProductPage();
});
