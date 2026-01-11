// /js/shared/components/skeletons.js

/**
 * Returns a generic product card skeleton string.
 * Mimics the structure of renderCard.js
 */
export function getProductCardSkeleton() {
  return `
    <article class="bg-transparent border-none overflow-hidden flex flex-col h-full opacity-60">
      <!-- Image Area -->
      <div class="aspect-[4/5] w-full bg-gray-100 relative overflow-hidden mb-3 skeleton rounded-none border border-transparent"></div>

      <!-- Content -->
      <div class="flex flex-col flex-1 gap-2 px-1">
        <!-- Title Lines -->
        <div class="h-3 w-3/4 skeleton"></div>
        <div class="h-3 w-1/2 skeleton"></div>

        <!-- Price -->
        <div class="mt-auto pt-2">
          <div class="h-5 w-1/3 skeleton"></div>
        </div>
      </div>
    </article>
  `;
}

/**
 * Returns a 99c card skeleton string.
 * Mimics render99cCard structure but simplified.
 */
export function get99cCardSkeleton() {
  return `
    <div class="snap-start h-full">
      <div class="relative w-[160px] md:w-[220px] flex-shrink-0 bg-white border border-gray-100 p-3 h-full flex flex-col gap-3 rounded-lg opacity-60">
        <!-- Image Placeholder with Rounded Corners -->
        <div class="aspect-square w-full bg-gray-100 rounded-md skeleton"></div>
        
        <!-- Content Area -->
        <div class="flex flex-col gap-2 mt-2 w-full">
            <!-- Title Line 1 (Longer) -->
            <div class="h-3 w-11/12 bg-gray-100 rounded skeleton"></div>
            <!-- Title Line 2 (Shorter) -->
            <div class="h-3 w-2/3 bg-gray-100 rounded skeleton"></div>
        </div>

        <div class="mt-auto pt-2 flex items-center justify-between w-full">
           <!-- Price Pill -->
           <div class="h-6 w-16 bg-gray-100 rounded-full skeleton"></div>
           <!-- Button Circle -->
           <div class="h-8 w-8 bg-gray-100 rounded-full skeleton"></div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Banner Slide Skeleton.
 * Matches .promo-slide dimensions and snap alignment.
 */
export function getBannerSkeleton() {
  // Use scale-100 and opacity-100 for the skeleton so it feels "active" immediately
  return `
    <div class="relative min-w-[85vw] md:min-w-[60%] shrink-0 snap-center overflow-hidden h-[300px] md:h-[450px] bg-gray-100 skeleton opacity-100 scale-100 shadow-xl border-none">
       <!-- Inner Content Box Hint -->
       <div class="absolute top-1/2 left-12 -translate-y-1/2 w-1/3 h-1/3 bg-white/50 skeleton rounded"></div>
    </div>
  `;
}

/**
 * Category Chip Skeleton
 * Matches chip styling but greyed out
 */
export function getCategoryChipSkeleton() {
  return `
     <div class="h-[46px] w-[120px] flex-shrink-0 border-4 border-gray-100 bg-transparent skeleton"></div>
  `;
}

/**
 * Helper to repeat a skeleton N times
 */
export function repeatSkeleton(templateFn, count = 4) {
  return Array(count).fill(0).map(() => templateFn()).join("");
}
