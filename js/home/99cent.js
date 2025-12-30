// /js/home/99cent.js
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../config/env.js";
import { render99cCard } from "../shared/components/productCard99c.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function qs(sel, root = document) {
  return root.querySelector(sel);
}

export async function init99CentSection() {
  const track = qs("[data-99c-track]");
  const empty = qs("[data-99c-empty]");
  const btnL = qs("[data-99c-left]");
  const btnR = qs("[data-99c-right]");

  if (!track) return;

  const { data, error } = await supabase
    .from("products")
    .select("id,slug,name,price,catalog_image_url,catalog_hover_url,primary_image_url,is_active,created_at")
    .eq("is_active", true)
    .eq("price", 0.99)
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) {
    console.warn("[99c] fetch failed:", error);
    track.innerHTML = "";
    if (empty) empty.classList.remove("is-hidden");
    return;
  }

  const items = data || [];
  if (!items.length) {
    track.innerHTML = "";
    if (empty) empty.classList.remove("is-hidden");
    return;
  }

  if (empty) empty.classList.add("is-hidden");

  track.innerHTML = items.map((p) => {
    return `<div class="kk-99c-card">${render99cCard(p)}</div>`;
  }).join("");

  const scrollByCards = (dir) => {
    const card = track.querySelector(".kk-99c-card");
    const dx = card ? (card.getBoundingClientRect().width + 14) * 1 : 260;
    track.scrollBy({ left: dir * dx, behavior: "smooth" });
  };

  btnL?.addEventListener("click", () => scrollByCards(-1));
  btnR?.addEventListener("click", () => scrollByCards(1));
}
