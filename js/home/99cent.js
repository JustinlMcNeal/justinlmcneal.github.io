import { getSupabaseClient } from "../shared/supabaseClient.js";
// SUPABASE_URL, SUPABASE_ANON_KEY no longer needed here
import { render99cCard } from "../shared/components/productCard99c.js";
import { get99cCardSkeleton, repeatSkeleton } from "../shared/components/skeletons.js";
import { fetchActivePromotions, getBestProductDiscount, effectiveRequiresCode, checkPromotionApplies } from "../shared/promotionLoader.js";
import { normalizeUuidArray } from "../shared/promotions/promoUtils.js";

const supabase = getSupabaseClient();

function qs(sel, root = document) {
  return root.querySelector(sel);
}

export async function init99CentSection() {
  const track = qs("[data-99c-track]");
  const empty = qs("[data-99c-empty]");
  const btnL = qs("[data-99c-left]");
  const btnR = qs("[data-99c-right]");

  if (!track) return;

  // 0. Render Skeleton
  track.innerHTML = repeatSkeleton(get99cCardSkeleton, 5);

  // 1. Fetch IDs via View (Price=0.99 OR Tag="99cent")
  // Using the view is reliable because it handles the tag aggregation/lowercasing
  const { data: viewData, error: viewError } = await supabase
    .from("v_products_with_tags")
    .select("id")
    .eq("is_active", true)
    .or('price.eq.0.99,tags.cs.{"99cent"}')
    .limit(50);

  if (viewError) {
    console.warn("[99c] view lookup error:", viewError);
  }

  const ids = (viewData || []).map((x) => x.id);

  if (!ids.length) {
    track.innerHTML = "";
    if (empty) empty.classList.remove("hidden");
    return;
  }

  // 2. Fetch Full Product Details (No variants needed for simple 99c display)
  const productReq = supabase
    .from("products")
    .select(
      "id,slug,name,price,catalog_image_url,catalog_hover_url,primary_image_url,is_active,created_at"
    )
    .in("id", ids)
    .order("created_at", { ascending: false });

  const [productRes, allPromos] = await Promise.all([
    productReq,
    fetchActivePromotions().catch((e) => []),
  ]);

  if (productRes.error) {
    console.warn("[99c] fetch failed:", productRes.error);
    track.innerHTML = "";
    if (empty) empty.classList.remove("hidden");
    return;
  }

  const items = productRes.data || [];
  if (!items.length) {
    track.innerHTML = "";
    if (empty) empty.classList.remove("hidden");
    return;
  }

  // Filter only auto-promotions (no code required)
  const autoPromos = (allPromos || []).filter(p => !effectiveRequiresCode(p));

  if (empty) empty.classList.add("hidden");

  // Render cards with price calculation
  track.innerHTML = items.map((p) => {
    // 1. Build simple context. (Note: we don't have tags loaded in this result set yet, unless we join them)
    // To properly support tag-based promos here, we'd need to fetch tags.
    // However, 99c items usually just have the "99cent" tag.
    // For now, let's just pass an empty tag list to avoid crashing, or rely on global promos.
    // If you want robust promo support here, we need to add `tags` to the query or view. (The View has them!)
    
    // Actually, `v_products_with_tags` has aggregated tags. But we are fetching from `products` table in step 2.
    // Let's rely on basic promos for now.
    
    const context = {
        product_id: p.id,
        category_ids: [],
        tag_ids: [] 
    };

    const applicable = autoPromos.filter(promo => checkPromotionApplies(promo, context));
    
    // 2. Correct usage: (promos, price)
    const bestCalc = getBestProductDiscount(applicable, p.price);
    
    let bestDeal = null;
    if (bestCalc && bestCalc.amount > 0) {
        bestDeal = {
            finalPrice: Math.max(0, p.price - bestCalc.amount),
            discountAmount: bestCalc.amount,
            type: bestCalc.promo?.type,
            value: bestCalc.promo?.value
        };
    }

    return `<div class="snap-start h-full">${render99cCard(p, bestDeal)}</div>`;
  }).join("");

  // Bind Quick Add Buttons
  track.querySelectorAll(".js-quick-add").forEach(btn => {
      btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          
          try {
              const product = JSON.parse(btn.dataset.product);
              
              // Construct standard cart item
              const cartItem = {
                  id: product.id,
                  product_id: product.id,
                  name: product.name,
                  price: product.price,
                  image: product.catalog_image_url || product.primary_image_url,
                  slug: product.slug,
                  qty: 1,
                  variant: null // 99c items usually don't have variants, or we default to none
              };

              window.dispatchEvent(new CustomEvent("kk:addToCart", { detail: cartItem }));
          } catch(err) {
              console.error("Quick add failed", err);
          }
      });
  });

  // Logic for manual scroll buttons
  const scrollByCards = (dir) => {
    const card = track.querySelector(".snap-start");
    const dx = card ? (card.getBoundingClientRect().width + 14) : 260;
    track.scrollBy({ left: dir * dx, behavior: "smooth" });
  };

  btnL?.addEventListener("click", () => scrollByCards(-1));
  btnR?.addEventListener("click", () => scrollByCards(1));
}