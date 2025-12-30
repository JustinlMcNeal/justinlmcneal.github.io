// /js/home/categoryStrip.js
import { fetchHomeCategoryStrip } from "./api.js";

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function titleCaseLower(s) {
  const x = String(s ?? "").trim();
  if (!x) return "";
  return x.charAt(0).toUpperCase() + x.slice(1);
}

function renderHomeCategoryStrip({
  categories = [],
  hrefBase = "/pages/catalog.html",
}) {
  const mount = document.querySelector("[data-home-catstrip]");
  if (!mount) return;

  const rows = (categories || []).filter(Boolean);

  mount.innerHTML = rows
    .map((c) => {
      const name = titleCaseLower(c.name);
      const count = Number(c.product_count || 0);
      const href = `${hrefBase}?category=${encodeURIComponent(c.slug || c.id)}`;
      const img = c.home_image_url || c.home_image_path || "";
return `
  <a class="kk-home-catcard" href="${href}" aria-label="All ${esc(name)}">
    ${
      img
        ? `<img src="${esc(img)}" alt="${esc(name)}" loading="lazy" decoding="async" />`
        : `<div style="width:100%;height:100%;background:rgba(0,0,0,.10)"></div>`
    }

    <div class="kk-home-catcard-label">
      <div class="kk-home-catcard-allrow">
        <span class="kk-home-catcard-all">All</span>
        <span class="kk-home-catcard-count" aria-label="${count} items">${count}</span>
      </div>
      <div class="kk-home-catcard-name">${esc(name)}</div>
    </div>
  </a>
`;


    })
    .join("");
}

export async function initHomeCategoryStrip() {
  try {
    const cats = await fetchHomeCategoryStrip();
    renderHomeCategoryStrip({ categories: cats });
  } catch (e) {
    console.warn("[home] category strip failed:", e);
  }
}
