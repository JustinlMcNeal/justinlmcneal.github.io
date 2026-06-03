// /js/admin/lineItemsOrders/ctaPrintFlow.js
// Shared CTA label print orchestration for the order workspace.
import { printLabel, determineLabelType } from "./labelPrint.js";
import { trackCtaLabelPrint, createCtaLabelLink } from "./api.js";
import { getOrderSource } from "./dom.js";

/**
 * @param {object} row - order row (v_order_summary_plus shape)
 * @returns {{ eligible: boolean, source: string, labelType: string, message: string }}
 */
export function getCtaEligibility(row) {
  const source = getOrderSource(row);
  const labelType = determineLabelType(source);

  if (labelType === "none") {
    return {
      eligible: false,
      source,
      labelType,
      message: "CTA labels are available for KK website, eBay, and Amazon orders.",
    };
  }

  if (source === "kk" && !row.kk_order_id) {
    return {
      eligible: false,
      source,
      labelType,
      message: "CTA label unavailable because this order is missing a KK order ID.",
    };
  }

  return { eligible: true, source, labelType, message: "" };
}

/**
 * Print a CTA label with the same tracking flow used by the legacy row button.
 *
 * @param {object} row
 * @param {{ buttonEl?: HTMLButtonElement }} [opts]
 * @returns {Promise<{ ok: boolean, message: string, isError?: boolean, trackingFailed?: boolean, linkCreated?: boolean }>}
 */
export async function printCtaForOrder(row, { buttonEl } = {}) {
  const eligibility = getCtaEligibility(row);
  if (!eligibility.eligible) {
    return { ok: false, message: eligibility.message, isError: true };
  }

  const origText = buttonEl?.textContent?.trim();
  if (buttonEl) {
    buttonEl.disabled = true;
    buttonEl.textContent = "\u23F3";
  }

  let trackingFailed = false;
  let linkCreated = false;

  try {
    await printLabel(row, {
      onPrinted: async ({ order, source, labelType, qrTarget, rewriteQr }) => {
        const trackResult = await trackCtaLabelPrint({
          sessionId: order.stripe_checkout_session_id,
          kkOrderId: order.kk_order_id || null,
          orderSource: source,
          labelType,
          metadata: { qr_target: qrTarget },
        });

        if (!trackResult.ok) {
          trackingFailed = true;
          console.warn("[ctaPrintFlow] CTA print tracking failed:", trackResult.error);
          await rewriteQr(qrTarget);
          return;
        }

        const linkResult = await createCtaLabelLink({
          printId: trackResult.id,
          sessionId: order.stripe_checkout_session_id,
          kkOrderId: order.kk_order_id || null,
          orderSource: source,
          labelType,
          destinationUrl: qrTarget,
          metadata: { qr_target: qrTarget },
        });

        if (!linkResult.ok) {
          trackingFailed = true;
          console.warn("[ctaPrintFlow] CTA label link creation failed:", linkResult.error);
          await rewriteQr(qrTarget);
          return;
        }

        linkCreated = true;
        await rewriteQr(linkResult.trackingUrl);
      },
    });

    let message;
    if (!trackingFailed && linkCreated) {
      message = "CTA label opened for printing. Scan tracking enabled.";
    } else if (trackingFailed) {
      message = "CTA label opened. Scan tracking unavailable \u2014 direct QR shown.";
    } else {
      message = "CTA label opened for printing.";
    }

    return { ok: true, message, isError: false, trackingFailed, linkCreated };
  } catch (err) {
    return {
      ok: false,
      message: "CTA label failed: " + (err.message || String(err)),
      isError: true,
    };
  } finally {
    if (buttonEl) {
      buttonEl.disabled = false;
      buttonEl.textContent = origText;
    }
  }
}
