// Pinterest board routing — search-intent + content type + category (client + shared logic)

const INTENT_KEYS = [
  "everyday-style",
  "gifting",
  "going-out",
  "cute-accessories",
  "seasonal",
  "customer-favorites",
  "best-sellers",
  "outfit-ideas",
  "product-category",
  "other",
];

const CONTENT_TYPES = [
  "product",
  "testimonial",
  "promo",
  "lifestyle",
  "brand",
  "educational",
  "ugc",
  "other",
];

export { INTENT_KEYS, CONTENT_TYPES };

/**
 * @param {object} params
 * @param {Array} params.boards — pinterest_boards rows with pinterest_board_id
 * @param {string|null} params.defaultPinterestBoardId — Pinterest API board id
 * @param {string|null} params.categoryId
 * @param {string} params.contentType
 * @param {Record<string,string>} [params.legacyCategoryMap] — category_id → pinterest board id
 */
export function resolvePinterestBoardRouting({
  boards,
  defaultPinterestBoardId,
  categoryId,
  contentType = "product",
  legacyCategoryMap = {},
}) {
  const active = (boards || []).filter(
    (b) => b.is_active !== false && b.pinterest_board_id
  );

  let best = null;
  let bestScore = 0;

  for (const board of active) {
    let score = 0;
    const types = board.content_types?.length ? board.content_types : ["product"];
    if (types.includes(contentType)) score += 2;

    const catIds = board.mapped_category_ids?.length
      ? board.mapped_category_ids
      : board.category_id
        ? [board.category_id]
        : [];

    if (categoryId && catIds.includes(categoryId)) score += 3;

    if (score > bestScore) {
      bestScore = score;
      best = board;
    }
  }

  if (best && bestScore >= 2) {
    return {
      pinterest_board_id: best.pinterest_board_id,
      pinterest_board_name: best.name,
      board_routing_method: "mapped",
      board_routing_warning: null,
      board_intent_key: best.intent_key || null,
    };
  }

  const defaultRow = active.find((b) => b.is_default);
  const fallbackId =
    defaultRow?.pinterest_board_id || defaultPinterestBoardId || null;
  const fallbackName = defaultRow?.name || null;

  if (fallbackId) {
    return {
      pinterest_board_id: fallbackId,
      pinterest_board_name: fallbackName,
      board_routing_method: "fallback",
      board_routing_warning: "no_mapped_board_found",
      board_intent_key: defaultRow?.intent_key || null,
    };
  }

  if (categoryId && legacyCategoryMap[categoryId]) {
    return {
      pinterest_board_id: legacyCategoryMap[categoryId],
      pinterest_board_name: null,
      board_routing_method: "mapped",
      board_routing_warning: "legacy_category_map",
      board_intent_key: null,
    };
  }

  return {
    pinterest_board_id: null,
    pinterest_board_name: null,
    board_routing_method: "none",
    board_routing_warning: "no_default_pinterest_board",
    board_intent_key: null,
  };
}
