// /js/home/index.js
import { initNavbar } from "../shared/navbar.js";

import { init99CentSection } from "./99cent.js";
import { initHomeCategoryStrip } from "./categoryStrip.js";

import {
  fetchHomePromo,
  fetchCategories,
  fetchHomeProducts,
  fetchVariantsForProducts,
  fetchHomeBestSellers
} from "./api.js";

import { renderHomeBanner } from "./renderBanner.js";
import { renderHomeCategories } from "./renderCategories.js";
import { renderHomeGrid } from "./renderGrid.js";

const state = {
  active: { mode: "best", categoryId: null }, // ✅ default
  categories: [],
  loading: false
};

async function loadInsert(mountId, path) {
  const mount = document.getElementById(mountId);
  if (!mount) return;

  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);

  mount.innerHTML = await res.text();
}

function setLoading(isLoading) {
  state.loading = isLoading;

  const grid = document.getElementById("homeProductGrid");
  if (grid) {
    grid.style.opacity = isLoading ? "0.65" : "1";
    grid.style.pointerEvents = isLoading ? "none" : "auto";
  }
}

async function loadBanner() {
  const promo = await fetchHomePromo();
  renderHomeBanner(promo);
}

function renderCategoriesUI() {
  renderHomeCategories({
    categories: state.categories,
    active: state.active,
    onChange: handleCategoryChange
  });
}

async function handleCategoryChange(next) {
  if (
    state.active?.mode === next?.mode &&
    state.active?.categoryId === next?.categoryId
  ) return;

  state.active = next;
  renderCategoriesUI();
  await loadGrid();
}

async function loadCategories() {
  const categories = await fetchCategories();
  state.categories = categories || [];
  renderCategoriesUI();
}

async function loadGrid() {
  try {
    setLoading(true);

    const isBest = state?.active?.mode === "best";
    const categoryId = state?.active?.categoryId ?? null;

    const products = isBest
      ? await fetchHomeBestSellers({ limit: 10 })
      : await fetchHomeProducts({ categoryId, limit: 10 });

    const ids = (products || []).map(p => p.id).filter(Boolean);
    const variantMap = await fetchVariantsForProducts(ids);

    renderHomeGrid(products || [], variantMap);
  } catch (err) {
    console.error("[home] grid load error:", err);
    renderHomeGrid([], new Map());
  } finally {
    setLoading(false);
  }
}


async function boot() {
  // 1) Navbar first
  await initNavbar();

  // 2) Load inserts BEFORE any renderers that rely on IDs inside inserts
  await Promise.all([
    loadInsert("homeBannerMount", "../../page_inserts/home/banner.html"),
    loadInsert("kkHomeCategoryStripMount", "../../page_inserts/home/category-strip.html"),
    loadInsert("kkHome99CentMount", "../../page_inserts/home/99cent.html"),
    loadInsert("kkHomeCatalogMount", "../../page_inserts/home/catalog.html")
  ]);

  // 3) Render promo + chips + category strip (safe now that inserts exist)
  await Promise.allSettled([
    loadBanner(),
    loadCategories(),
    initHomeCategoryStrip()
  ]);

  // 4) Grid (depends on chips existing)
  await loadGrid();

  // 5) 99¢ slider (depends on its insert existing)
  await init99CentSection();
}

boot().catch((err) => {
  console.error("[home] fatal init error:", err);
});
