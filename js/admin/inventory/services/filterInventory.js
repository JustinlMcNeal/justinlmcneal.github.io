/**
 * Client-side inventory table filtering and sorting (live + mock rows).
 */

/** @typedef {'all'|'lowStock'|'unmapped'|'issues'} InventoryTab */

/**
 * @param {import('./mapWorkspaceRow.js').InventoryRow} row
 * @param {InventoryTab} activeTab
 */
export function tabMatches(row, activeTab) {
  if (activeTab === "all") return true;
  if (activeTab === "lowStock") {
    return row.status === "low" || (row.available <= row.threshold && row.available > 0);
  }
  if (activeTab === "unmapped") return row.unmapped;
  if (activeTab === "issues") return row.hasIssue;
  return true;
}

/**
 * @param {import('./mapWorkspaceRow.js').InventoryRow} row
 * @param {Record<string, string>} filters
 */
export function filterMatches(row, filters) {
  const q = filters.search.trim().toLowerCase();
  if (q) {
    const hay = [
      row.title,
      row.variant,
      row.variantDetail,
      row.internalSku,
      row.shortSku,
      row.ebaySku,
      row.ebayListingId,
      row.amazonAsin,
      row.amazonSellerSku,
    ]
      .join(" ")
      .toLowerCase();
    if (!hay.includes(q)) return false;
  }
  if (filters.status && row.status !== filters.status) return false;
  if (filters.category && row.category !== filters.category) return false;
  if (filters.syncState && row.syncState !== filters.syncState) return false;
  if (filters.issueType && !row.issueTypes.includes(filters.issueType)) return false;
  if (filters.inventoryState) {
    if (filters.inventoryState === "in_stock" && row.available <= 0) return false;
    if (filters.inventoryState === "low" && row.status !== "low") return false;
    if (filters.inventoryState === "out" && row.available !== 0) return false;
    if (filters.inventoryState === "negative" && row.onHand >= 0) return false;
    if (filters.inventoryState === "negative_available" && row.available >= 0) return false;
    if (filters.inventoryState === "reserved" && row.reserved <= 0) return false;
  }
  if (filters.channel) {
    if (filters.channel === "kk" && row.kkStock == null) return false;
    if (filters.channel === "ebay" && row.ebayStock == null && !row.ebayListingId) return false;
    if (filters.channel === "amazon" && row.amazonStock == null && !row.amazonAsin) return false;
    if (filters.channel === "parcel" && !row.issueTypes.includes("parcel_mapping_missing")) {
      return false;
    }
  }
  return true;
}

/** @param {import('./mapWorkspaceRow.js').InventoryRow[]} rows @param {Record<string, string>} filters */
export function sortInventoryRows(rows, filters) {
  const sorted = [...rows];
  const { sortBy } = filters;
  sorted.sort((a, b) => {
    if (sortBy === "title_desc") return b.title.localeCompare(a.title);
    if (sortBy === "available_asc") return a.available - b.available;
    if (sortBy === "available_desc") return b.available - a.available;
    if (sortBy === "updated_desc") return (b.updatedAtMs ?? 0) - (a.updatedAtMs ?? 0);
    return a.title.localeCompare(b.title);
  });
  return sorted;
}

/** @param {import('./mapWorkspaceRow.js').InventoryRow[]} rows @param {InventoryTab} activeTab @param {Record<string, string>} filters */
export function filterInventoryRows(rows, activeTab, filters) {
  return sortInventoryRows(
    rows.filter((row) => tabMatches(row, activeTab) && filterMatches(row, filters)),
    filters,
  );
}

/** @param {import('./mapWorkspaceRow.js').InventoryRow[]} rows */
export function computeTabCounts(rows) {
  return {
    all: rows.length,
    lowStock: rows.filter(
      (r) => r.status === "low" || (r.available <= r.threshold && r.available > 0),
    ).length,
    unmapped: rows.filter((r) => r.unmapped).length,
    issues: rows.filter((r) => r.hasIssue).length,
  };
}
