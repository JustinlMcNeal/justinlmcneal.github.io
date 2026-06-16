// /js/admin/lineItemsOrders/workspaceFinancials.js
// Renders the Financials tab HTML for the order workspace.
// Owns: eBay finance breakdown, standard order summary, cost & profit display.
import { sh } from "./workspaceUtils.js";
import { moneyFromCents, getOrderSource } from "./dom.js";

export function renderFinancials(order, shipment) {
  const isEbay = getOrderSource(order) === "ebay";
  const isAmazon = getOrderSource(order) === "amazon";
  const ef = order.ebay_financials;
  const af = order.amazon_financials;

  let html = '<div class="p-3 sm:p-6 space-y-6">';

  if (isEbay) {
    const finStatus = ef?.finance_status || "missing";
    const hasEarnings = ef?.ebay_order_earnings_cents != null;
    const isEstimated = finStatus === "estimated";

    const statusBadgeMap = {
      complete: '<span class="border-[2px] border-emerald-500 text-emerald-600 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider">✓ COMPLETE</span>',
      estimated: '<span class="border-[2px] border-amber-400 text-amber-700 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider">≈ EST · Ad fee pending</span>',
      estimated_no_ad_fee: '<span class="border-[2px] border-amber-300 text-amber-600 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider">≈ EST · No ad fee</span>',
      partial: '<span class="border-[2px] border-amber-400 text-amber-600 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider">≈ PARTIAL</span>',
      pending_finances: '<span class="border-[2px] border-blue-300 text-blue-600 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider">🕐 PENDING FINANCES</span>',
      missing: '<span class="border-[2px] border-gray-300 text-gray-500 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider">? NO DATA</span>',
    };
    const statusBadge = statusBadgeMap[finStatus] || "";

    html += `<section>
      ${sh("eBay Order Summary")}
      <div class="mb-3 flex items-center gap-2">${statusBadge}</div>
      <div class="grid sm:grid-cols-3 gap-4">
        <div class="border-4 border-black p-4">
          <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">Buyer Subtotal</div>
          <div class="font-black text-lg">${moneyFromCents(order.subtotal_paid_cents)}</div>
          <div class="text-[9px] text-black/40 mt-1">From eBay Fulfillment API</div>
        </div>
        <div class="border-4 border-black p-4">
          <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">eBay Tax (Buyer)</div>
          <div class="font-black text-lg text-gray-500">${moneyFromCents(order.tax_cents)}</div>
          <div class="text-[9px] text-black/40 mt-1">eBay collects &amp; remits — not our revenue</div>
        </div>
        <div class="border-4 border-black p-4 bg-black text-white">
          <div class="text-[10px] font-black uppercase tracking-[.18em] text-white/60 mb-1">Buyer Total</div>
          <div class="font-black text-lg">${moneyFromCents(order.total_paid_cents)}</div>
        </div>
      </div>
      ${
        hasEarnings
          ? `<div class="mt-4 grid sm:grid-cols-4 gap-4">
        <div class="border-4 border-black p-4">
          <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">eBay Fees Total</div>
          <div class="font-black text-lg text-red-600">${moneyFromCents(ef.ebay_total_fee_cents)}</div>
          <div class="text-[9px] text-black/40 mt-1">FVF${ef.per_order_ad_fee_cents > 0 ? " + Promo" : ""}</div>
        </div>
        <div class="border-4 border-black p-4">
          <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">Final Value Fee</div>
          <div class="font-black text-red-600">${moneyFromCents(ef.fee_final_value_cents)}</div>
          <div class="text-[9px] text-black/40 mt-1">In SALE transaction</div>
        </div>
        <div class="border-4 ${isEstimated ? "border-amber-300 bg-amber-50" : "border-black"} p-4">
          <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">Promoted Listing</div>
          ${
            isEstimated
              ? `<div class="font-black text-amber-600">—</div><div class="text-[9px] text-amber-600 mt-1">Not yet billed (1-2 day lag)</div>`
              : `<div class="font-black text-red-600">${moneyFromCents(ef.per_order_ad_fee_cents || 0)}</div><div class="text-[9px] text-black/40 mt-1">Separate NON_SALE_CHARGE</div>`
          }
        </div>
        <div class="border-4 border-black p-4">
          <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">Other Fees</div>
          <div class="font-black text-red-600">${moneyFromCents(
            (ef.fee_regulatory_cents || 0) +
              (ef.fee_international_cents || 0) +
              (ef.fee_other_cents || 0)
          )}</div>
          <div class="text-[9px] text-black/40 mt-1">Regulatory + Intl + Other</div>
        </div>
      </div>
      <div class="mt-3 border-4 ${isEstimated ? "border-amber-300 bg-amber-50" : "border-emerald-200 bg-emerald-50"} p-4 flex items-center justify-between">
        <div>
          <div class="text-[10px] font-black uppercase tracking-[.18em] ${isEstimated ? "text-amber-700/70" : "text-emerald-700/70"} mb-1">
            eBay Seller Earnings${isEstimated ? " (BEFORE promo fee)" : ""}
          </div>
          <div class="font-black text-xl ${isEstimated ? "text-amber-700" : "text-emerald-700"}">${moneyFromCents(ef.ebay_order_earnings_cents)}</div>
          <div class="text-[9px] ${isEstimated ? "text-amber-600/60" : "text-emerald-600/60"} mt-1">
            SALE.amount ${ef.per_order_ad_fee_cents > 0 ? "− Promoted listing fee" : ""} · ${ef.finance_synced_at ? new Date(ef.finance_synced_at).toLocaleDateString() : "—"}
          </div>
          ${isEstimated ? `<div class="text-[9px] text-amber-700 mt-1 font-black">⚠ Promoted listing fee not yet captured — final earnings will be lower</div>` : ""}
        </div>
        <div class="text-[10px] font-black uppercase tracking-[.18em] ${isEstimated ? "text-amber-700/50" : "text-emerald-700/50"}">
          = SALE − ${isEstimated ? "?" : "all"} fees
        </div>
      </div>`
          : `<div class="mt-4 border-4 border-blue-200 bg-blue-50 p-4">
        <div class="font-black text-sm text-blue-700 uppercase tracking-wider">eBay Finance Data Not Yet Available</div>
        <div class="text-xs text-blue-600 mt-1">eBay Finance API transactions are typically available 1–2 days after a sale. Run the eBay Finance sync to populate this data.</div>
      </div>`
      }
    </section>
    <div class="border-t-4 border-gray-100"></div>`;

    // eBay Cost & Profit
    const profitCents = order.profit_cents;
    const profitKnown = profitCents != null;
    const profitColor = Number(profitCents) > 0 ? "text-emerald-600" : "text-red-600";

    html += `<section>
      ${sh("Cost & eBay Net Profit")}
      ${
        isEstimated
          ? `<div class="mb-4 border-4 border-amber-400 bg-amber-50 p-3 flex items-center gap-3">
        <span class="text-lg">⚠</span>
        <div class="text-[11px] text-amber-800">
          <strong>Promoted listing fee pending</strong> — eBay typically bills the ad fee 1-2 days after a sale. Re-run the eBay Finance sync tomorrow.
        </div>
      </div>`
          : ""
      }
      <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div class="border-4 border-black p-4">
          <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">Landed CPI</div>
          <div class="font-black text-lg text-red-600">${moneyFromCents(order.product_cpi_cents)}</div>
          <div class="text-[9px] text-black/50 mt-1">Variant override or product CPI + est. China ship</div>
        </div>
        <div class="border-4 border-black p-4">
          <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">USPS Label</div>
          <div class="font-black text-lg text-red-600">${moneyFromCents(shipment?.label_cost_cents)}</div>
        </div>
        <div class="border-4 border-black p-4">
          <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">eBay Earnings</div>
          <div class="font-black text-lg ${hasEarnings ? (isEstimated ? "text-amber-700" : "text-emerald-700") : "text-gray-400"}">
            ${hasEarnings ? moneyFromCents(ef.ebay_order_earnings_cents) : "—"}
          </div>
          <div class="text-[9px] text-black/50 mt-1">
            ${isEstimated ? "Before promo fee" : hasEarnings ? "After all eBay fees" : "Not yet synced"}
          </div>
        </div>
        <div class="border-4 border-black p-4 ${profitKnown ? "bg-emerald-50" : "bg-amber-50 border-amber-300"}">
          <div class="text-[10px] font-black uppercase tracking-[.18em] ${profitKnown ? "text-emerald-700/60" : "text-amber-700/70"} mb-1">
            ${profitKnown ? "Net Profit" : "Profit (pending)"}
          </div>
          <div class="font-black text-lg ${profitKnown ? profitColor : "text-amber-600"}">
            ${profitKnown ? moneyFromCents(profitCents) : "—"}
          </div>
          ${!profitKnown ? '<div class="text-[9px] text-amber-700 mt-1">Ad fee not yet captured</div>' : ""}
        </div>
      </div>
      ${
        profitKnown
          ? `<div class="mt-3 text-[10px] text-black/50 leading-relaxed">
        <strong>Formula:</strong> eBay earnings (${moneyFromCents(ef?.ebay_order_earnings_cents)}) − Product CPI (${moneyFromCents(order.product_cpi_cents)}) − USPS label (${moneyFromCents(shipment?.label_cost_cents)}) = <strong>${moneyFromCents(profitCents)}</strong>
      </div>`
          : `<div class="mt-3 text-[10px] text-amber-700 leading-relaxed border-l-4 border-amber-400 pl-3">
        Best case: ${moneyFromCents(ef?.ebay_order_earnings_cents)} − ${moneyFromCents(order.product_cpi_cents)} − ${moneyFromCents(shipment?.label_cost_cents)} = <strong>${moneyFromCents(
                  (ef?.ebay_order_earnings_cents || 0) -
                    (order.product_cpi_cents || 0) -
                    (shipment?.label_cost_cents || 0)
                )}</strong> (overstated until ad fee synced)
      </div>`
      }
    </section>`;
  } else if (isAmazon) {
    const finStatus = af?.finance_status || "missing";
    const hasEarnings = af?.amazon_order_earnings_cents != null;
    const statusBadgeMap = {
      complete: '<span class="border-[2px] border-emerald-500 text-emerald-600 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider">✓ COMPLETE</span>',
      partial: '<span class="border-[2px] border-amber-400 text-amber-600 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider">≈ PARTIAL</span>',
      pending_finances: '<span class="border-[2px] border-blue-300 text-blue-600 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider">🕐 PENDING FINANCES</span>',
      missing: '<span class="border-[2px] border-gray-300 text-gray-500 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider">? NO DATA</span>',
    };

    html += `<section>
      ${sh("Amazon Order Summary")}
      <div class="mb-3 flex items-center gap-2">${statusBadgeMap[finStatus] || ""}</div>
      <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div class="border-4 border-black p-4">
          <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">Buyer Subtotal</div>
          <div class="font-black text-lg">${moneyFromCents(order.subtotal_paid_cents)}</div>
          <div class="text-[9px] text-black/40 mt-1">Item prices only</div>
        </div>
        <div class="border-4 border-black p-4">
          <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">Shipping (Buyer)</div>
          <div class="font-black text-lg">${moneyFromCents(order.shipping_paid_cents)}</div>
          <div class="text-[9px] text-black/40 mt-1">Shipping + shipping tax</div>
        </div>
        <div class="border-4 border-black p-4">
          <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">Amazon Tax (Buyer)</div>
          <div class="font-black text-lg text-gray-500">${moneyFromCents(order.tax_cents)}</div>
          <div class="text-[9px] text-black/40 mt-1">Amazon collects &amp; remits — not our revenue</div>
        </div>
        <div class="border-4 border-black p-4 bg-black text-white">
          <div class="text-[10px] font-black uppercase tracking-[.18em] text-white/60 mb-1">Buyer Total</div>
          <div class="font-black text-lg">${moneyFromCents(order.total_paid_cents)}</div>
          <div class="text-[9px] text-white/50 mt-1">Subtotal + shipping + tax</div>
        </div>
      </div>
      ${
        hasEarnings
          ? `<div class="mt-4 grid sm:grid-cols-3 gap-4">
        <div class="border-4 border-black p-4">
          <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">Amazon Fees</div>
          <div class="font-black text-lg text-red-600">${moneyFromCents(af.amazon_total_fee_cents)}</div>
        </div>
        <div class="border-4 border-black p-4">
          <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">Referral / FBA</div>
          <div class="font-black text-red-600">${moneyFromCents((af.fee_referral_cents || 0) + (af.fee_fba_cents || 0))}</div>
        </div>
        <div class="border-4 border-emerald-200 bg-emerald-50 p-4">
          <div class="text-[10px] font-black uppercase tracking-[.18em] text-emerald-700/70 mb-1">Amazon Earnings</div>
          <div class="font-black text-lg text-emerald-700">${moneyFromCents(af.amazon_order_earnings_cents)}</div>
        </div>
      </div>`
          : `<div class="mt-3 text-xs text-gray-500">Run <strong>Sync Amazon Finances</strong> from Export menu to pull fee data (may lag up to 48h).</div>`
      }
    </section>
    <div class="border-t-4 border-gray-100"></div>`;

    const profitCents = order.profit_cents;
    const profitKnown = profitCents != null && finStatus !== "pending_finances";
    const profitColor = Number(profitCents) > 0 ? "text-emerald-600" : "text-red-600";

    html += `<section>
      ${sh("Cost & Amazon Net Profit")}
      <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div class="border-4 border-black p-4">
          <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">Landed CPI</div>
          <div class="font-black text-lg text-red-600">${moneyFromCents(order.product_cpi_cents)}</div>
          <div class="text-[9px] text-black/50 mt-1">Variant override or product CPI + est. China ship</div>
        </div>
        <div class="border-4 border-black p-4">
          <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">USPS Label</div>
          <div class="font-black text-lg text-red-600">${moneyFromCents(shipment?.label_cost_cents)}</div>
        </div>
        <div class="border-4 border-black p-4">
          <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">Amazon Earnings</div>
          <div class="font-black text-lg ${hasEarnings ? "text-emerald-700" : "text-gray-400"}">${hasEarnings ? moneyFromCents(af.amazon_order_earnings_cents) : "—"}</div>
        </div>
        <div class="border-4 border-black p-4 ${profitKnown ? "bg-emerald-50" : "bg-amber-50 border-amber-300"}">
          <div class="text-[10px] font-black uppercase tracking-[.18em] ${profitKnown ? "text-emerald-700/60" : "text-amber-700/70"} mb-1">Net Profit</div>
          <div class="font-black text-lg ${profitKnown ? profitColor : "text-amber-600"}">${profitKnown ? moneyFromCents(profitCents) : "—"}</div>
        </div>
      </div>
    </section>`;
  } else {
    // Standard (non-eBay)
    html += `<section>
      ${sh("Order Summary")}
      <div class="grid sm:grid-cols-3 gap-4">
        <div class="border-4 border-black p-4">
          <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">Subtotal</div>
          <div class="font-black text-lg">${moneyFromCents(order.subtotal_paid_cents)}</div>
        </div>
        <div class="border-4 border-black p-4">
          <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">Shipping</div>
          <div class="font-black text-lg">${moneyFromCents(order.shipping_paid_cents)}</div>
        </div>
        <div class="border-4 border-black p-4 bg-black text-white">
          <div class="text-[10px] font-black uppercase tracking-[.18em] text-white/60 mb-1">Total Paid</div>
          <div class="font-black text-lg">${moneyFromCents(order.total_paid_cents)}</div>
        </div>
      </div>
    </section>
    <div class="border-t-4 border-gray-100"></div>`;

    const shippingMargin = (order.shipping_paid_cents || 0) - (shipment?.label_cost_cents || 0);
    const marginBg = shipment?.label_cost_cents
      ? shippingMargin >= 0
        ? "bg-emerald-50"
        : "bg-red-50"
      : "";
    const marginColor = shippingMargin >= 0 ? "text-emerald-600" : "text-red-600";

    html += `<section>
      ${sh("Cost & Profit")}
      <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div class="border-4 border-black p-4">
          <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">Landed CPI</div>
          <div class="font-black text-lg text-red-600">${moneyFromCents(order.product_cpi_cents)}</div>
          <div class="text-[9px] text-black/50 mt-1">Variant override or product CPI + est. China ship</div>
        </div>
        <div class="border-4 border-black p-4">
          <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">USPS Label</div>
          <div class="font-black text-lg text-red-600">${moneyFromCents(shipment?.label_cost_cents)}</div>
        </div>
        <div class="border-4 border-black p-4 ${marginBg}">
          <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">Shipping Margin</div>
          ${
            shipment?.label_cost_cents
              ? `<div class="font-black text-lg ${marginColor}">${moneyFromCents(shippingMargin)}</div>
               <div class="text-[9px] text-black/50 mt-1">${moneyFromCents(order.shipping_paid_cents)} paid − ${moneyFromCents(shipment.label_cost_cents)} label</div>`
              : `<div class="font-black text-lg text-gray-400">—</div>
               <div class="text-[9px] text-black/50 mt-1">${moneyFromCents(order.shipping_paid_cents)} paid · no label yet</div>`
          }
        </div>
        <div class="border-4 border-black p-4 bg-emerald-50">
          <div class="text-[10px] font-black uppercase tracking-[.18em] text-emerald-700/60 mb-1">Profit</div>
          <div class="font-black text-lg text-emerald-600">${moneyFromCents(order.profit_cents)}</div>
        </div>
      </div>
    </section>`;
  }

  html += "</div>";
  return html;
}
