// /js/admin/lineItemsOrders/amazonOrderSync.js
// Pull Amazon orders via SP-API (amazon-sync-orders edge function).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "/js/config/env.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export async function syncAmazonOrders({ daysBack = 30 } = {}) {
  const { data: { session }, error: sessionErr } = await supabase.auth.getSession();
  if (sessionErr || !session?.access_token) {
    throw new Error("Admin session required.");
  }

  const resp = await fetch(`${SUPABASE_URL}/functions/v1/amazon-sync-orders`, {
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
    throw new Error(`Amazon sync failed (${resp.status})`);
  }

  if (!resp.ok || !data?.ok) {
    const hint = data?.hint ? ` (${data.hint})` : "";
    throw new Error((data?.error || `Amazon sync failed (${resp.status})`) + hint);
  }

  return data;
}

export async function syncAmazonFinances({ daysBack = 30 } = {}) {
  const { data: { session }, error: sessionErr } = await supabase.auth.getSession();
  if (sessionErr || !session?.access_token) {
    throw new Error("Admin session required.");
  }

  const resp = await fetch(`${SUPABASE_URL}/functions/v1/amazon-sync-finances`, {
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
    throw new Error(`Amazon finance sync failed (${resp.status})`);
  }

  if (!resp.ok || !data?.ok) {
    const hint = data?.hint ? ` (${data.hint})` : "";
    throw new Error((data?.error || `Amazon finance sync failed (${resp.status})`) + hint);
  }

  return data;
}

export function wireAmazonOrderSync({ buttonEl, setStatus, onSynced } = {}) {
  if (!buttonEl) return;

  buttonEl.addEventListener("click", async () => {
    const original = buttonEl.textContent;
    buttonEl.disabled = true;
    buttonEl.textContent = "Syncing…";
    setStatus?.("Pulling Amazon orders from SP-API…");

    try {
      const result = await syncAmazonOrders({ daysBack: 30 });
      const unmapped = result.unmappedSkus?.length
        ? ` · ${result.unmappedSkus.length} unmapped SKU(s)`
        : "";
      const piiNote = result.piiEnrichErrors?.length
        ? ` · PII blocked: ${result.piiEnrichErrors[0]}`
        : result.addressesEnriched > 0 || result.buyerInfoEnriched > 0
          ? ` · ${result.addressesEnriched} address(es), ${result.buyerInfoEnriched || 0} buyer email(s) enriched`
          : "";
      setStatus?.(
        `Amazon sync done: ${result.synced} orders upserted (${result.fetched} fetched).${unmapped}${piiNote} Cron still runs every 4h.`,
      );
      onSynced?.(result);
    } catch (err) {
      console.error(err);
      setStatus?.(`Amazon sync failed: ${err?.message || err}`, true);
    } finally {
      buttonEl.disabled = false;
      buttonEl.textContent = original;
    }
  });
}

export function wireAmazonFinanceSync({ buttonEl, setStatus, onSynced } = {}) {
  if (!buttonEl) return;

  buttonEl.addEventListener("click", async () => {
    const original = buttonEl.textContent;
    buttonEl.disabled = true;
    buttonEl.textContent = "Syncing…";
    setStatus?.("Pulling Amazon finance transactions…");

    try {
      const result = await syncAmazonFinances({ daysBack: 30 });
      setStatus?.(
        `Amazon finances synced: ${result.upserted} transactions (${result.fetched} fetched). Daily cron also runs at 7 AM UTC.`,
      );
      onSynced?.(result);
    } catch (err) {
      console.error(err);
      setStatus?.(`Amazon finance sync failed: ${err?.message || err}`, true);
    } finally {
      buttonEl.disabled = false;
      buttonEl.textContent = original;
    }
  });
}
