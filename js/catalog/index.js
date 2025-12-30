// js/catalog/index.js
import { initNavbar } from "../shared/navbar.js";
import { fetchActiveProducts, fetchCategories } from "./api.js";
import { getProductPromotions, getBestProductDiscount } from "../shared/promotionLoader.js";
import { getPromoCardBanner, getPromoBadgeHTML, getPromoExpiryMessage } from "../shared/promotionDisplay.js";

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (m) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]
  ));
}

function money(n) {
  const num = Number(n || 0);
  return num.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function getImg(p) {
  return p.catalog_image_url || p.primary_image_url || "/imgs/brand/placeholder.png";
}

document.addEventListener("DOMContentLoaded", async () => {
  // Shared UI (menu/cart drawers, checkout wiring, cart count/subtotal, etc.)
  initNavbar();

  const els = {
    search: document.getElementById("catalogSearch"),
    chips: document.getElementById("categoryChips"),
    grid: document.getElementById("productGrid"),
    count: document.getElementById("catalogCount"),
  };

  let allProducts = [];
  let allCategories = [];
  let activeCategoryId = "all";
  let promosByProduct = {}; // Cache product promos

  function renderChips() {
    if (!els.chips) return;

    const chips = [
      { id: "all", name: "All" },
      ...allCategories.map((c) => ({ id: String(c.id), name: c.name })),
    ];

    els.chips.innerHTML = chips
      .map((c) => {
        const active = String(activeCategoryId) === String(c.id);
        return `
          <button
            type="button"
            class="kk-chip ${active ? "is-active" : ""}"
            data-cat="${escapeHtml(c.id)}"
          >
            ${escapeHtml(c.name)}
          </button>
        `;
      })
      .join("");

    els.chips.querySelectorAll("[data-cat]").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeCategoryId = btn.dataset.cat;
        renderChips();
        renderGrid();
      });
    });
  }

  function filterProducts() {
    const q = (els.search?.value || "").trim().toLowerCase();

    return allProducts.filter((p) => {
      const matchesCat =
        activeCategoryId === "all" || String(p.category_id) === String(activeCategoryId);

      if (!matchesCat) return false;
      if (!q) return true;

      return (
        (p.name || "").toLowerCase().includes(q) ||
        (p.slug || "").toLowerCase().includes(q)
      );
    });
  }

  function renderGrid() {
    if (!els.grid) return;

    const items = filterProducts();

    if (els.count) {
      els.count.textContent = `${items.length} item${items.length === 1 ? "" : "s"}`;
    }

    els.grid.innerHTML = items
      .map((p) => {
        const img = getImg(p);
        const hover = p.catalog_hover_url || "";
        const url = `/pages/product.html?sku=${encodeURIComponent(p.slug)}`;
        const promos = promosByProduct[p.id] || [];
        const promoBanner = getPromoCardBanner(promos);

        const { amount: priceDiscount } = getBestProductDiscount(promos, Number(p.price || 0));
          const priceHtml = priceDiscount > 0
          ? `<span class="kk-price kk-price--old" style="text-decoration:line-through; opacity:.6;">${money(p.price)}</span>
             <span class="kk-price kk-price--new" style="color:#16a34a; margin-left:8px;">${money(Math.max(0, Number(p.price || 0) - priceDiscount))}</span>`
          : `<span class="kk-price">${money(p.price)}</span>`;

          // If there is a percentage promo, add a small badge next to price
          const pctPromo = (promos || []).filter((pr) => pr.type === "percentage").sort((a,b) => Number(b.value||0) - Number(a.value||0))[0];
          const priceBadge = pctPromo ? `<span style="margin-left:8px;">${getPromoBadgeHTML(pctPromo)}</span>` : "";
          const expiryMsg = (promos && promos.length) ? getPromoExpiryMessage(promos[0]) : "";
          const expiryHtml = expiryMsg ? `<div class="kk-product-sub" style="margin-top:6px;">${escapeHtml(expiryMsg)}</div>` : "";

        return `
          <a class="kk-card kk-product" href="${url}">
            <div class="kk-product-media" data-hover="${escapeHtml(hover)}">
              <img
                src="${escapeHtml(img)}"
                alt="${escapeHtml(p.name || "")}"
                loading="lazy"
              />
              ${promoBanner}
            </div>
            <div class="kk-product-body">
              <div class="kk-product-name">${escapeHtml(p.name || "")}</div>
              <div class="kk-product-price">${priceHtml}${priceBadge}</div>
              ${expiryHtml}
            </div>
          </a>
        `;
      })
      .join("");

    // Hover swap (desktop)
    els.grid.querySelectorAll(".kk-product-media").forEach((wrap) => {
      const hoverUrl = wrap.getAttribute("data-hover");
      if (!hoverUrl) return;

      const img = wrap.querySelector("img");
      if (!img) return;

      const original = img.getAttribute("src");
      wrap.addEventListener("mouseenter", () => img.setAttribute("src", hoverUrl));
      wrap.addEventListener("mouseleave", () => img.setAttribute("src", original));
    });
  }

  async function loadProductPromotions() {
    try {
      // Load promos for each product
      for (const product of allProducts) {
        const categoryIds = product.category_id ? [product.category_id] : [];
        const tagIds = product.tags ? product.tags.map((t) => t.id || t) : [];
        promosByProduct[product.id] = await getProductPromotions(
          product.id,
          categoryIds,
          tagIds
        );
        if (promosByProduct[product.id].length > 0) {
          console.log(`[Catalog] Product ${product.name} has ${promosByProduct[product.id].length} promo(s)`, promosByProduct[product.id]);
        }
      }
    } catch (err) {
      console.error("Error loading product promotions:", err);
    }
  }

  async function init() {
    try {
      if (els.grid) els.grid.innerHTML = `<div class="kk-sub">Loading products…</div>`;

      [allProducts, allCategories] = await Promise.all([
        fetchActiveProducts(),
        fetchCategories(),
      ]);

      // Load promotions for all products
      await loadProductPromotions();

      renderChips();
      renderGrid();

      els.search?.addEventListener("input", renderGrid);
    } catch (err) {
      console.error(err);
      if (els.grid) {
        els.grid.innerHTML = `<div class="kk-sub" style="color:#b91c1c;">Failed to load catalog: ${escapeHtml(err?.message || err)}</div>`;
      }
    }
  }

  init();
});
