// /js/admin/lineItemsOrders/ebayOrderSync.js
// Pull eBay orders via Fulfillment API (ebay-sync-orders edge function).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "/js/config/env.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export async function syncEbayOrders({ daysBack = 30 } = {}) {
  const { data: { session }, error: sessionErr } = await supabase.auth.getSession();
  if (sessionErr || !session?.access_token) {
    throw new Error("Admin session required.");
  }

  const resp = await fetch(`${SUPABASE_URL}/functions/v1/ebay-sync-orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ days_back: daysBack }),
  });

  let data;
  try {
    data = await resp.json();
  } catch {
    throw new Error(`eBay sync failed (${resp.status})`);
  }

  if (!resp.ok || !data?.success) {
    throw new Error(data?.error || `eBay sync failed (${resp.status})`);
  }

  return data;
}

export function wireEbayOrderSync({ buttonEl, setStatus, onSynced } = {}) {
  if (!buttonEl) return;

  buttonEl.addEventListener("click", async () => {
    const original = buttonEl.textContent;
    buttonEl.disabled = true;
    buttonEl.textContent = "Syncing…";
    setStatus?.("Pulling eBay orders from Fulfillment API…");

    try {
      const result = await syncEbayOrders({ daysBack: 30 });
      const matchNote = Number.isFinite(result.matched) || Number.isFinite(result.unmatched)
        ? ` · ${result.matched ?? 0} matched, ${result.unmatched ?? 0} unmatched`
        : "";
      setStatus?.(
        `eBay sync done: ${result.synced ?? 0} new, ${result.updated ?? 0} updated` +
          (result.variantsRepaired ? `, ${result.variantsRepaired} variants fixed` : "") +
          ` (${result.skipped ?? 0} skipped).${matchNote} Cron still runs every 2h.`,
      );
      onSynced?.(result);
    } catch (err) {
      console.error(err);
      setStatus?.(`eBay sync failed: ${err?.message || err}`, true);
    } finally {
      buttonEl.disabled = false;
      buttonEl.textContent = original;
    }
  });
}
