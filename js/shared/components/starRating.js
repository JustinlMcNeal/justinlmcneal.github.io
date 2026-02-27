// /js/shared/components/starRating.js
// Reusable star rating display component.

/**
 * Render a star rating as HTML.
 * @param {number} avgRating - Average rating (1-5, can be decimal)
 * @param {number} reviewCount - Number of reviews
 * @param {object} opts - Options
 * @param {string} opts.size - "sm" (catalog cards) | "md" (product page) | "lg" (large display)
 * @param {boolean} opts.showCount - Whether to show "(N)" review count text
 * @param {string} opts.linkTo - Optional anchor link (e.g. "#reviews")
 * @returns {string} HTML string
 */
export function renderStarRating(avgRating, reviewCount, opts = {}) {
  const size = opts.size || "sm";
  const showCount = opts.showCount !== false;
  const linkTo = opts.linkTo || "";

  if (!reviewCount || reviewCount === 0) {
    if (opts.showEmpty) {
      return `<div class="star-rating star-rating--empty flex items-center gap-1">
        <span class="${sizeClasses(size).stars} text-black/15">${emptyStars()}</span>
        ${showCount ? `<span class="${sizeClasses(size).count} text-black/30">No reviews</span>` : ""}
      </div>`;
    }
    return "";
  }

  const fullStars = Math.floor(avgRating);
  const hasHalf = avgRating - fullStars >= 0.3;
  const emptyCount = 5 - fullStars - (hasHalf ? 1 : 0);

  const starsHtml =
    fullStar().repeat(fullStars) +
    (hasHalf ? halfStar() : "") +
    emptyStar().repeat(emptyCount);

  const sc = sizeClasses(size);
  const ratingText = avgRating.toFixed(1);

  const inner = `
    <div class="star-rating flex items-center gap-1.5">
      <span class="${sc.stars} text-amber-400 flex items-center">${starsHtml}</span>
      ${showCount ? `<span class="${sc.count} text-black/50 font-semibold">${ratingText} (${reviewCount})</span>` : ""}
    </div>
  `;

  if (linkTo) {
    return `<a href="${linkTo}" class="hover:opacity-80 transition-opacity inline-block">${inner}</a>`;
  }
  return inner;
}

function sizeClasses(size) {
  switch (size) {
    case "lg":
      return { stars: "text-xl", count: "text-sm" };
    case "md":
      return { stars: "text-base", count: "text-xs" };
    case "sm":
    default:
      return { stars: "text-sm", count: "text-[10px]" };
  }
}

function fullStar() {
  return `<svg class="inline w-[1em] h-[1em]" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/></svg>`;
}

let _halfStarId = 0;

function halfStar() {
  const id = `halfGrad${++_halfStarId}`;
  return `<svg class="inline w-[1em] h-[1em]" viewBox="0 0 20 20"><defs><linearGradient id="${id}"><stop offset="50%" stop-color="currentColor"/><stop offset="50%" stop-color="#d4d4d4"/></linearGradient></defs><path fill="url(#${id})" d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/></svg>`;
}

function emptyStar() {
  return `<svg class="inline w-[1em] h-[1em] text-black/15" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/></svg>`;
}

function emptyStars() {
  return emptyStar().repeat(5);
}
