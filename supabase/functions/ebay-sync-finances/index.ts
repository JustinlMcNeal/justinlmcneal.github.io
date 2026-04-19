// ebay-sync-finances — Pull eBay financial transactions (fees, shipping labels, refunds)
// via the Finances API and insert into expenses table + update fulfillment_shipments label costs.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, apikey, x-client-info",
  "Content-Type": "application/json",
};

const EBAY_API = "https://apiz.ebay.com";

/** Ensure we have a valid access token, refreshing if expired */
async function getAccessToken(
  supabase: ReturnType<typeof createClient>
): Promise<string> {
  const { data: tokenRow } = await supabase
    .from("marketplace_tokens")
    .select("*")
    .eq("platform", "ebay")
    .single();

  if (!tokenRow?.access_token) throw new Error("eBay not connected");

  const expiresAt = new Date(tokenRow.token_expires_at).getTime();
  if (Date.now() < expiresAt - 5 * 60 * 1000) {
    return tokenRow.access_token;
  }

  // Refresh expired token
  console.log("[ebay-fin] Access token expired, refreshing...");
  const clientId = Deno.env.get("EBAY_CLIENT_ID") || "";
  const clientSecret = Deno.env.get("EBAY_CLIENT_SECRET") || "";
  const basicAuth = btoa(`${clientId}:${clientSecret}`);

  const scopes = [
    "https://api.ebay.com/oauth/api_scope",
    "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
    "https://api.ebay.com/oauth/api_scope/sell.inventory",
    "https://api.ebay.com/oauth/api_scope/sell.finances",
  ].join(" ");

  const resp = await fetch(
    "https://api.ebay.com/identity/v1/oauth2/token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokenRow.refresh_token,
        scope: scopes,
      }),
    }
  );

  const data = await resp.json();
  if (!resp.ok || data.error) {
    throw new Error(
      `Token refresh failed: ${data.error_description || data.error}`
    );
  }

  const newExpiresAt = new Date(
    Date.now() + (data.expires_in || 7200) * 1000
  ).toISOString();

  await supabase
    .from("marketplace_tokens")
    .update({
      access_token: data.access_token,
      token_expires_at: newExpiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("platform", "ebay");

  return data.access_token;
}

interface FinTransaction {
  transactionId: string;
  orderId?: string;
  transactionType: string;
  transactionStatus: string;
  transactionDate: string;
  transactionMemo?: string;
  bookingEntry: string;
  amount: { value: string; currency: string };
  totalFeeAmount?: { value: string; currency: string };
  orderLineItems?: Array<{
    lineItemId: string;
    feeBasisAmount?: { value: string; currency: string };
    marketplaceFees?: Array<{
      feeType: string;
      amount: { value: string; currency: string };
    }>;
  }>;
}

/** Fetch financial transactions from eBay Finances API */
async function fetchTransactions(
  accessToken: string,
  daysBack: number,
  transactionType?: string
): Promise<FinTransaction[]> {
  const since = new Date(
    Date.now() - daysBack * 24 * 60 * 60 * 1000
  ).toISOString();
  const now = new Date().toISOString();
  const transactions: FinTransaction[] = [];
  let offset = 0;
  const limit = 200;

  while (true) {
    let filterParts = `transactionDate:[${since}..${now}]`;
    if (transactionType) {
      filterParts += `&filter=transactionType:{${transactionType}}`;
    }

    const url = `${EBAY_API}/sell/finances/v1/transaction?filter=${encodeURIComponent(filterParts)}&limit=${limit}&offset=${offset}`;

    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      },
    });

    // 204 = no transactions in this range
    if (resp.status === 204) break;

    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`[ebay-fin] API error ${resp.status}:`, errText);
      throw new Error(`eBay Finances API ${resp.status}: ${errText.slice(0, 200)}`);
    }

    const data = await resp.json();
    const pageTxns = (data.transactions || []) as FinTransaction[];
    transactions.push(...pageTxns);

    console.log(
      `[ebay-fin] Fetched ${pageTxns.length} transactions (offset=${offset}, total=${data.total})`
    );

    if (offset + limit >= (data.total || 0)) break;
    offset += limit;
  }

  return transactions;
}

function toCents(amount: string | number | undefined): number {
  if (amount == null) return 0;
  return Math.round(parseFloat(String(amount)) * 100);
}

function absAmountCents(amount: { value: string } | undefined): number {
  if (!amount) return 0;
  return Math.abs(toCents(amount.value));
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const supabase = createClient(supabaseUrl, serviceKey);

    // Accept optional daysBack parameter (default: 30)
    let daysBack = 30;
    try {
      const body = await req.json();
      if (body?.days_back)
        daysBack = Math.min(365, Math.max(1, body.days_back));
    } catch {
      /* no body is fine */
    }

    const accessToken = await getAccessToken(supabase);

    // Fetch all transaction types at once (no filter = all types)
    const transactions = await fetchTransactions(accessToken, daysBack);

    if (!transactions.length) {
      return new Response(
        JSON.stringify({
          success: true,
          fees_synced: 0,
          labels_updated: 0,
          message: "No transactions found",
        }),
        { headers: corsHeaders }
      );
    }

    // Group SALE transactions to aggregate fees per month
    const monthlyFees: Map<
      string,
      { totalCents: number; orderCount: number; feeBreakdown: Map<string, number> }
    > = new Map();

    // Track shipping label costs per order
    const labelCosts: Map<string, number> = new Map();
    let labelUpdated = 0;

    // Track individually inserted non-sale charges
    let nonSaleInserted = 0;

    // Process each transaction
    for (const txn of transactions) {
      const txnDate = txn.transactionDate
        ? txn.transactionDate.slice(0, 10)
        : new Date().toISOString().slice(0, 10);
      const monthKey = txnDate.slice(0, 7); // "YYYY-MM"

      if (txn.transactionType === "SALE") {
        // Aggregate fees per month from SALE transactions
        const totalFee = absAmountCents(txn.totalFeeAmount);
        if (totalFee > 0) {
          if (!monthlyFees.has(monthKey)) {
            monthlyFees.set(monthKey, {
              totalCents: 0,
              orderCount: 0,
              feeBreakdown: new Map(),
            });
          }
          const month = monthlyFees.get(monthKey)!;
          month.totalCents += totalFee;
          month.orderCount++;

          // Collect fee breakdown
          for (const oli of txn.orderLineItems || []) {
            for (const fee of oli.marketplaceFees || []) {
              const feeType = fee.feeType || "OTHER";
              const feeCents = absAmountCents(fee.amount);
              month.feeBreakdown.set(
                feeType,
                (month.feeBreakdown.get(feeType) || 0) + feeCents
              );
            }
          }
        }
      } else if (txn.transactionType === "SHIPPING_LABEL") {
        // Track label costs per order for fulfillment_shipments update
        if (txn.orderId && txn.bookingEntry === "DEBIT") {
          const cost = absAmountCents(txn.amount);
          const existing = labelCosts.get(txn.orderId) || 0;
          labelCosts.set(txn.orderId, existing + cost);
        }
      } else if (txn.transactionType === "NON_SALE_CHARGE") {
        // Individual fee entries (subscriptions, ad fees billed separately)
        const refId = `ebay_api_fee_${txn.transactionId}`;
        const amountCents = absAmountCents(txn.amount);
        if (amountCents === 0) continue;

        // Dedup check
        const { data: existingFee } = await supabase
          .from("expenses")
          .select("id")
          .ilike("notes", `%${refId}%`)
          .maybeSingle();

        if (existingFee) continue;

        const desc =
          txn.transactionMemo
            ? `eBay — ${txn.transactionMemo}`
            : "eBay — Non-sale charge";

        const { error: feeErr } = await supabase.from("expenses").insert({
          expense_date: txnDate,
          category: "Software",
          description: desc,
          amount_cents: amountCents,
          vendor: "eBay",
          notes: `Auto-imported from eBay Finances API. Ref: ${refId}`,
        });

        if (feeErr) {
          console.error("[ebay-fin] Fee insert error:", feeErr.message);
        } else {
          nonSaleInserted++;
        }
      }
      // REFUND and CREDIT types are informational — order refund tracking is
      // already handled in orders_raw via the order sync or admin UI
    }

    // Insert aggregated monthly selling fees
    let feeMonthsInserted = 0;
    for (const [month, data] of monthlyFees) {
      if (data.totalCents === 0) continue;
      const refId = `ebay_api_selling_fees_${month}`;

      // Dedup
      const { data: existingMonth } = await supabase
        .from("expenses")
        .select("id")
        .ilike("notes", `%${refId}%`)
        .maybeSingle();

      if (existingMonth) continue;

      // Build fee breakdown note
      const breakdownParts: string[] = [];
      for (const [feeType, cents] of data.feeBreakdown) {
        breakdownParts.push(`${feeType}: $${(cents / 100).toFixed(2)}`);
      }

      const { error: monthErr } = await supabase.from("expenses").insert({
        expense_date: `${month}-01`,
        category: "Fees",
        description: `eBay Selling Fees — ${month} (${data.orderCount} orders)`,
        amount_cents: data.totalCents,
        vendor: "eBay",
        notes: `Auto-imported from eBay Finances API. ${breakdownParts.join(", ")}. Ref: ${refId}`,
      });

      if (monthErr) {
        console.error(`[ebay-fin] Monthly fee insert error for ${month}:`, monthErr.message);
      } else {
        feeMonthsInserted++;
      }
    }

    // Update fulfillment_shipments with label costs
    for (const [ebayOrderId, costCents] of labelCosts) {
      // Try both API and CSV session IDs
      const sessionIds = [
        `ebay_api_${ebayOrderId}`,
        `ebay_${ebayOrderId}`,
      ];

      for (const sid of sessionIds) {
        const { data: shipment } = await supabase
          .from("fulfillment_shipments")
          .select("id, label_cost_cents")
          .eq("stripe_checkout_session_id", sid)
          .maybeSingle();

        if (shipment) {
          // Only update if label_cost_cents is 0 or null (don't overwrite existing)
          if (!shipment.label_cost_cents) {
            const { error: updateErr } = await supabase
              .from("fulfillment_shipments")
              .update({
                label_cost_cents: costCents,
                updated_at: new Date().toISOString(),
              })
              .eq("id", shipment.id);

            if (updateErr) {
              console.error(`[ebay-fin] Label cost update error for ${sid}:`, updateErr.message);
            } else {
              labelUpdated++;
              console.log(`[ebay-fin] Updated label cost for ${sid}: $${(costCents / 100).toFixed(2)}`);
            }
          }
          break; // Found the shipment, no need to check CSV ID
        }
      }
    }

    const result = {
      success: true,
      transactions_processed: transactions.length,
      fee_months_inserted: feeMonthsInserted,
      non_sale_charges_inserted: nonSaleInserted,
      label_costs_updated: labelUpdated,
      label_costs_found: labelCosts.size,
    };

    console.log("[ebay-fin] Done:", JSON.stringify(result));

    return new Response(JSON.stringify(result), { headers: corsHeaders });
  } catch (err: unknown) {
    console.error(
      "[ebay-fin] Error:",
      err instanceof Error ? err.message : String(err)
    );
    return new Response(
      JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      }),
      { status: 500, headers: corsHeaders }
    );
  }
});
