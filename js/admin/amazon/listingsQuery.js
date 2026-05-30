import { profitSortValue } from "./listingProfit.js";
import { healthMatchesFilter } from "./listingHealth.js";
import { fulfillmentMatchesFilter } from "./listingFulfillment.js";

const MARKETPLACE_BY_COUNTRY = {
  US: "ATVPDKIKX0DER",
  CA: "A2EUQ1WTGCTBG2",
  MX: "A1AM78C64UM0Y8",
};

const CATEGORY_KEYWORDS = {
  bags: ["bag", "handbag", "tote", "purse"],
  jewelry: ["jewelry", "necklace", "bracelet", "earring"],
  accessories: ["accessory", "accessories", "charm", "keychain"],
  headwear: ["beanie", "hat", "headwear", "cap"],
  keychains: ["keychain", "key chain"],
};

function rowTitle(row) {
  return String(row.kk_product_title || row.amazon_title || "");
}

function rowSku(row) {
  return String(row.kk_sku || row.seller_sku || "");
}

function rowInventory(row) {
  const kkStock = Number(row.kk_stock);
  if (Number.isFinite(kkStock) && kkStock >= 0) return kkStock;
  const fbm = Number(row.fbm_quantity);
  if (Number.isFinite(fbm)) return fbm;
  const fba = Number(row.fba_fulfillable_quantity);
  if (Number.isFinite(fba)) return fba;
  return null;
}

function matchesSearch(row, query) {
  const trimmed = String(query || "").trim().toLowerCase();
  if (!trimmed) return true;
  const haystack = [
    rowTitle(row),
    rowSku(row),
    row.seller_sku,
    row.asin,
    row.amazon_title,
  ].map((v) => String(v || "").toLowerCase()).join(" ");
  return haystack.includes(trimmed);
}

function matchesStatus(row, status) {
  if (!status) return true;
  return String(row.listing_status || "") === status;
}

function matchesMarketplace(row, countryCode) {
  if (!countryCode) return true;
  const marketplaceId = MARKETPLACE_BY_COUNTRY[countryCode];
  if (!marketplaceId) return true;
  return String(row.marketplace_id || "") === marketplaceId;
}

function matchesCategory(row, category) {
  if (!category) return true;
  const keywords = CATEGORY_KEYWORDS[category] || [category];
  const haystack = [
    rowTitle(row),
    row.product_type,
    row.kk_sku,
  ].map((v) => String(v || "").toLowerCase()).join(" ");
  return keywords.some((word) => haystack.includes(word));
}

function matchesInventory(row, inventoryFilter) {
  if (!inventoryFilter) return true;
  const status = String(row.listing_status || "");
  const qty = rowInventory(row);
  if (inventoryFilter === "out") {
    return status === "out_of_stock" || qty === 0;
  }
  if (inventoryFilter === "low") {
    return status === "low_stock" || (qty !== null && qty > 0 && qty <= 5);
  }
  if (inventoryFilter === "in_stock") {
    return qty !== null && qty > 5 && status !== "out_of_stock";
  }
  return true;
}

function matchesPriceCompare(row, priceCompareFilter) {
  if (!priceCompareFilter) return true;
  const status = String(row.price_compare_status || "");
  if (priceCompareFilter === "mismatch") return row.has_price_mismatch === true;
  if (priceCompareFilter === "amazon_higher") return status === "amazon_higher";
  if (priceCompareFilter === "amazon_lower") return status === "amazon_lower";
  if (priceCompareFilter === "match") return status === "match";
  return true;
}

function matchesInventoryCompare(row, inventoryCompareFilter) {
  if (!inventoryCompareFilter) return true;
  const status = String(row.inventory_compare_status || "");
  if (inventoryCompareFilter === "mismatch") return row.has_inventory_mismatch === true;
  if (inventoryCompareFilter === "amazon_higher") return status === "amazon_higher";
  if (inventoryCompareFilter === "amazon_lower") return status === "amazon_lower";
  if (inventoryCompareFilter === "match") return status === "match";
  if (inventoryCompareFilter === "fba_managed") return status === "fba_managed";
  return true;
}

/**
 * @param {Array<Record<string, unknown>>} rows
 * @param {Record<string, unknown>} query
 */
export function filterListings(rows, query) {
  return rows.filter((row) =>
    matchesSearch(row, query.search) &&
    matchesStatus(row, query.status) &&
    matchesMarketplace(row, query.marketplace) &&
    matchesCategory(row, query.category) &&
    matchesInventory(row, query.inventory) &&
    matchesPriceCompare(row, query.priceCompare) &&
    matchesInventoryCompare(row, query.inventoryCompare) &&
    healthMatchesFilter(row, query.health) &&
    fulfillmentMatchesFilter(row, query.fulfillment),
  );
}

/**
 * @param {Array<Record<string, unknown>>} rows
 * @param {string} sortKey
 */
export function sortListings(rows, sortKey) {
  const list = [...rows];
  const key = String(sortKey || "last_synced_desc");

  list.sort((a, b) => {
    switch (key) {
      case "title_asc":
        return rowTitle(a).localeCompare(rowTitle(b), undefined, { sensitivity: "base" });
      case "price_desc": {
        const priceA = Number(a.price);
        const priceB = Number(b.price);
        return (Number.isFinite(priceB) ? priceB : -1) - (Number.isFinite(priceA) ? priceA : -1);
      }
      case "inventory_asc": {
        const invA = rowInventory(a);
        const invB = rowInventory(b);
        return (invA ?? Number.MAX_SAFE_INTEGER) - (invB ?? Number.MAX_SAFE_INTEGER);
      }
      case "profit_desc":
        return profitSortValue(b) - profitSortValue(a);
      case "last_synced_desc":      default: {
        const timeA = Date.parse(String(a.last_synced_at || ""));
        const timeB = Date.parse(String(b.last_synced_at || ""));
        return (Number.isFinite(timeB) ? timeB : 0) - (Number.isFinite(timeA) ? timeA : 0);
      }
    }
  });

  return list;
}

/**
 * @param {Array<Record<string, unknown>>} rows
 * @param {number} page
 * @param {number} pageSize
 */
export function paginateListings(rows, page, pageSize) {
  const size = Math.max(1, Number(pageSize) || 25);
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const currentPage = Math.min(Math.max(1, Number(page) || 1), totalPages);
  const start = (currentPage - 1) * size;
  const end = start + size;

  return {
    rows: rows.slice(start, end),
    total,
    totalPages,
    page: currentPage,
    pageSize: size,
    startIndex: total === 0 ? 0 : start + 1,
    endIndex: total === 0 ? 0 : Math.min(end, total),
  };
}

export function defaultListingsQuery() {
  return {
    search: "",
    status: "",
    category: "",
    marketplace: "",
    inventory: "",
    priceCompare: "",
    inventoryCompare: "",
    health: "",
    fulfillment: "",
    sort: "last_synced_desc",
    page: 1,
    pageSize: 25,
  };
}

export { MARKETPLACE_BY_COUNTRY };
