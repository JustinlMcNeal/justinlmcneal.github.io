// /js/shared/cart/freeShippingBar.js
// Renders the free shipping progress bar in cart drawer

import { getSupabaseClient } from "../supabaseClient.js";

let cachedSettings = null;

/**
 * Fetch free shipping settings from Supabase
 * Caches the result to avoid repeated API calls
 */
export async function getFreeShippingSettings() {
  if (cachedSettings !== null) return cachedSettings;
  
  try {
    const supabase = getSupabaseClient();
    const { data } = await supabase
      .from("site_settings")
      .select("value")
      .eq("key", "free_shipping")
      .single();

    cachedSettings = data?.value || { enabled: false };
    return cachedSettings;
  } catch (err) {
    console.warn("[FreeShippingBar] Failed to load settings:", err.message);
    cachedSettings = { enabled: false };
    return cachedSettings;
  }
}

/**
 * Render the free shipping progress bar
 * @param {number} subtotal - Current cart subtotal
 * @param {HTMLElement} container - Where to render the bar
 */
export async function renderFreeShippingBar(subtotal, container) {
  if (!container) return;

  const settings = await getFreeShippingSettings();
  
  if (!settings.enabled) {
    container.innerHTML = "";
    container.style.display = "none";
    return;
  }

  const threshold = parseFloat(settings.threshold) || 50;
  const msgUnder = settings.message_under || "Spend ${remaining} more for FREE shipping!";
  const msgReached = settings.message_reached || "🎉 You qualify for FREE shipping!";

  const remaining = Math.max(0, threshold - subtotal);
  const progress = Math.min(100, (subtotal / threshold) * 100);
  const qualified = remaining <= 0;

  // Build message
  let message = qualified 
    ? msgReached 
    : msgUnder.replace("${remaining}", `$${remaining.toFixed(2)}`);

  container.style.display = "block";
  container.innerHTML = `
    <div class="py-3">
      <div class="text-sm font-bold text-center mb-2 ${qualified ? 'text-green-600' : ''}">
        ${escapeHtml(message)}
      </div>
      <div class="h-2 bg-gray-200 rounded-full overflow-hidden">
        <div 
          class="h-full rounded-full transition-all duration-500 ${qualified ? 'bg-green-500' : 'bg-black'}" 
          style="width: ${progress}%"
        ></div>
      </div>
      ${!qualified ? `
        <div class="flex justify-between text-[10px] mt-1 opacity-60">
          <span>$0</span>
          <span>$${threshold.toFixed(0)}</span>
        </div>
      ` : ''}
    </div>
  `;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Clear cached settings (call when admin updates settings)
 */
export function clearFreeShippingCache() {
  cachedSettings = null;
}
