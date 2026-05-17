// /js/admin/lineItemsOrders/labelPrint.js
// Phase 2B: CTA label generation and print window.
// KK orders  → "review_cta"  : QR → leave-review.html?oid=<kk_order_id>
// eBay orders → "channel_cta" : QR → karrykraze.com homepage
// Amazon      → "none"        : deferred — will use channel_cta once Amazon flow is verified
// Unknown     → "none"        : no button shown
//
// Discount codes shown on labels:
//   THANKYOU15 (KK review CTA) — must exist in coupons table before printing
//   DIRECT15   (eBay channel CTA) — must exist in coupons table before printing
//
// See: docs/audit/implementation/ctaLabel/001_phase2_implementation_plan.md
import { getOrderSource, esc } from "./dom.js";

// QR library — loaded lazily on first printLabel() call to avoid ~40kb on page load
let _qrLib = null;

async function loadQrLib() {
  if (_qrLib) return _qrLib;
  try {
    const mod = await import("https://esm.sh/qrcode@1");
    _qrLib = mod.default ?? mod;
    return _qrLib;
  } catch (err) {
    console.error("[labelPrint] Failed to load QR library:", err);
    return null;
  }
}

/**
 * Generate a QR code as a PNG data URL.
 * Returns null on failure — buildLabelHtml falls back to plain text URL.
 * @param {string} url
 * @returns {Promise<string|null>}
 */
async function generateQrDataUrl(url) {
  const QRCode = await loadQrLib();
  if (!QRCode?.toDataURL) return null;
  try {
    return await QRCode.toDataURL(url, {
      width: 200,
      margin: 1,
      color: { dark: "#000000", light: "#ffffff" },
    });
  } catch (err) {
    console.error("[labelPrint] QR generation error:", err);
    return null;
  }
}

/**
 * Determine which label type to print for a given order source.
 * @param {"kk"|"ebay"|"amazon"|"unknown"} source
 * @returns {"review_cta"|"channel_cta"|"none"}
 */
export function determineLabelType(source) {
  if (source === "kk") return "review_cta";
  if (source === "ebay") return "channel_cta";
  // Amazon: deferred to Phase 3 — use "channel_cta" once Amazon order flow is finalized
  // Unknown: no label
  return "none";
}

/**
 * Build the QR target URL for the given label type.
 * KK review CTA: deep-links to leave-review.html with kk_order_id pre-filled.
 *   leave-review.html reads ?oid= to prefill the order ID field (same pattern as my-orders).
 * eBay channel CTA: points to karrykraze.com homepage with UTM attribution.
 *
 * @param {object} order  - order row (v_order_summary_plus shape)
 * @param {string} source - "kk" | "ebay" | "amazon" | "unknown"
 * @param {"review_cta"|"channel_cta"} labelType
 * @returns {string}
 */
export function buildQrTarget(order, source, labelType) {
  if (labelType === "review_cta") {
    // Use kk_order_id — verify-order edge function does .eq("kk_order_id", ...) so only
    // kk_order_id values work. If missing, _ctaRowExtras already suppresses the button;
    // this path is only reached when kk_order_id is present.
    const oid = encodeURIComponent(order.kk_order_id || "");
    return `https://karrykraze.com/pages/leave-review.html?oid=${oid}&utm_source=packing_label&utm_medium=qr&utm_campaign=review_cta`;
  }
  if (labelType === "channel_cta") {
    return "https://karrykraze.com/?utm_source=packing_label&utm_medium=qr&utm_campaign=ebay_direct_cta";
  }
  return "https://karrykraze.com";
}

/**
 * Build a complete print-window HTML document for the CTA label.
 * Label dimensions: 3.5" × 2" (set via @page CSS).
 * All CSS is inline — the print window has no external stylesheets.
 * No PII is included: no email, phone, address, or internal session IDs.
 *
 * @param {object} order - order row
 * @param {"review_cta"|"channel_cta"} labelType
 * @param {{ qrDataUrl?: string|null, qrFallbackUrl?: string }} options
 * @returns {string} Full <!DOCTYPE html> string
 */
export function buildLabelHtml(order, labelType, options = {}) {
  const { qrDataUrl = null, qrFallbackUrl = "https://karrykraze.com", printDelayMs = 400 } = options;

  const qrBlock = qrDataUrl
    ? `<img src="${qrDataUrl}" width="80" height="80" style="display:block;border:none;" alt="Scan QR code">`
    : `<div style="width:80px;height:80px;border:1px solid #000;display:flex;align-items:center;justify-content:center;font-size:5pt;text-align:center;word-break:break-all;padding:3px;">${esc(qrFallbackUrl)}</div>`;

  const firstName = order.first_name ? esc(order.first_name) : null;

  let headline, cta1, cta2, coupon;
  if (labelType === "review_cta") {
    headline  = firstName ? `Thanks,<br>${firstName}!` : `Thanks for<br>ordering!`;
    cta1      = "Scan to leave a quick review";
    cta2      = "and get 15% off your next order.";
    coupon    = "THANKYOU15";
  } else {
    headline  = `Like your<br>order?`;
    cta1      = `Order direct at KarryKraze.com`;
    cta2      = `Scan for 15% off your first website order.`;
    coupon    = "DIRECT15";
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>KK CTA Label</title>
  <style>
    @page { size: 3.5in 2in; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      width: 3.5in; height: 2in; overflow: hidden;
      font-family: Arial, Helvetica, sans-serif;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    @media print { body { width: 3.5in; height: 2in; } }
  </style>
</head>
<body onload="setTimeout(function(){window.print();},${printDelayMs})">
  <div style="width:3.5in;height:2in;display:flex;flex-direction:column;border:1px solid #000;">

    <!-- Header bar -->
    <div style="background:#000;color:#fff;padding:3px 10px;font-size:8pt;font-weight:900;letter-spacing:.14em;flex-shrink:0;">
      KARRY KRAZE
    </div>

    <!-- Body -->
    <div style="flex:1;display:flex;flex-direction:row;align-items:center;padding:6px 10px;gap:9px;min-height:0;">

      <!-- Text column -->
      <div style="flex:1;min-width:0;">
        <div style="font-size:11pt;font-weight:900;line-height:1.15;letter-spacing:-.01em;">${headline}</div>
        <div style="font-size:7pt;margin-top:5px;line-height:1.5;color:#111;">
          ${esc(cta1)}<br>${esc(cta2)}
        </div>
        <div style="margin-top:7px;font-size:6.5pt;font-weight:700;letter-spacing:.06em;background:#f0f0f0;padding:2px 5px;display:inline-block;border:1px solid #ccc;">
          ${esc(coupon)}
        </div>
      </div>

      <!-- QR column -->
      <div style="flex-shrink:0;display:flex;flex-direction:column;align-items:center;gap:2px;">
        ${qrBlock}
        <div style="font-size:5pt;color:#666;text-align:center;line-height:1.2;">scan me</div>
      </div>

    </div>

    <!-- Footer -->
    <div style="border-top:1px solid #d1d5db;padding:2px 10px;font-size:6pt;color:#9ca3af;text-align:right;flex-shrink:0;">
      karrykraze.com
    </div>

  </div>
</body>
</html>`;
}

/**
 * Open a print window with the appropriate CTA label for the given order.
 * The window.open() is called synchronously (must be invoked from a user gesture
 * click handler to avoid popup blockers). QR generation is async and happens after
 * the window is already open and showing a loading placeholder.
 *
 * onPrinted receives { order, source, labelType, qrTarget, rewriteQr } where:
 *   rewriteQr(newUrl) — regenerates QR with newUrl and rewrites the print window.
 *   Caller MUST call rewriteQr (with tracking URL or with qrTarget as fallback).
 *   If onPrinted does not call rewriteQr (throws), labelPrint.js writes the direct URL label.
 *
 * @param {object} order - order row (v_order_summary_plus shape)
 * @param {object} [opts]
 * @param {function} [opts.onPrinted] - async callback({ order, source, labelType, qrTarget, rewriteQr })
 */
export async function printLabel(order, { onPrinted } = {}) {
  const source = getOrderSource(order);
  const labelType = determineLabelType(source);
  if (labelType === "none") return;

  // Open window immediately — must be synchronous from user gesture
  const pw = window.open("", "kkCtaLabel", "width=520,height=320");
  if (!pw) {
    alert("Popup blocked \u2014 please allow popups for this site.");
    return;
  }

  // Show loading placeholder while QR generates and tracking link is created
  pw.document.write(
    "<!DOCTYPE html><html><head><title>Preparing label\u2026</title></head>" +
    "<body style=\"font-family:sans-serif;padding:20px;font-size:13px;\">Preparing CTA label\u2026</body></html>"
  );
  pw.document.close();

  const qrTarget = buildQrTarget(order, source, labelType);
  const qrDataUrl = await generateQrDataUrl(qrTarget);

  // rewriteQr — called by onPrinted with tracking URL or direct qrTarget (fallback).
  // Regenerates QR and rewrites the print window. Uses 400ms print delay.
  async function rewriteQr(newQrTarget) {
    if (!pw || pw.closed) return;
    const newQrDataUrl = newQrTarget === qrTarget
      ? qrDataUrl                            // reuse the already-generated data URL
      : await generateQrDataUrl(newQrTarget);
    const html = buildLabelHtml(order, labelType, {
      qrDataUrl:     newQrDataUrl,
      qrFallbackUrl: newQrTarget,
      printDelayMs:  400,
    });
    pw.document.open();
    pw.document.write(html);
    pw.document.close();
  }

  if (typeof onPrinted === "function") {
    try {
      // onPrinted is responsible for calling rewriteQr before returning.
      // labelPrint.js intentionally avoids importing api.js to keep the
      // dependency direction clean: UI/print logic here, Supabase writes in api.js.
      await onPrinted({ order, source, labelType, qrTarget, rewriteQr });
    } catch (err) {
      // Tracking failures are non-fatal — write direct URL label as safety net.
      console.warn("[labelPrint] onPrinted callback error:", err);
      await rewriteQr(qrTarget);
    }
  } else {
    // No callback — write direct URL label immediately.
    await rewriteQr(qrTarget);
  }
}

/**
 * @deprecated Phase 2B stub — superseded by the onPrinted callback pattern in Phase 2C.
 * Tracking is now handled in index.js wireCta via trackCtaLabelPrint (api.js).
 * Kept to avoid breaking any external callers; safe to remove in Phase 3.
 */
export async function trackLabelPrint(_sessionId, _labelType) {
  // no-op: tracking is now handled via the onPrinted callback passed to printLabel()
}
