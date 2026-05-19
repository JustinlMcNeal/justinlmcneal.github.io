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
 * Label dimensions: 6" × 4" (set via @page CSS).
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
    ? `<img src="${qrDataUrl}" width="176" height="176" style="display:block;width:1.82in;height:1.82in;border:0;" alt="Scan QR code">`
    : `<div style="width:1.82in;height:1.82in;border:3px solid #000;display:flex;align-items:center;justify-content:center;font-size:7pt;text-align:center;word-break:break-all;padding:10px;line-height:1.2;">${esc(qrFallbackUrl)}</div>`;

  const firstName = order.first_name ? esc(order.first_name) : null;

  let headline, cta1, cta2, rewardLabel, rewardLines, rewardLineStyle, footerLeft, footerRight;
  if (labelType === "review_cta") {
    headline  = firstName ? `Thanks,<br>${firstName}!` : `Thanks for<br>ordering!`;
    cta1      = "Scan to leave a quick review";
    cta2      = "and unlock 15% off your next order.";
    rewardLabel = "UNLOCK YOUR REWARD";
    rewardLines = ["LEAVE A REVIEW", "GET 15% OFF"];
    rewardLineStyle = "font-size:12pt;font-weight:900;letter-spacing:.035em;line-height:1;";
    footerLeft = "Thank you for supporting Karry Kraze";
    footerRight = "Review reward";
  } else {
    headline  = `Like your<br>order?`;
    cta1      = "Scan to shop direct next time";
    cta2      = "and get 15% off your first website order.";
    rewardLabel = "USE CODE";
    rewardLines = ["DIRECT15"];
    rewardLineStyle = "font-size:24pt;font-weight:900;letter-spacing:.035em;line-height:.95;";
    footerLeft = "Shop direct with Karry Kraze";
    footerRight = "Save more";
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>KK CTA Label</title>
  <style>
    @page { size: 6in 4in; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      width: 6in; height: 4in; overflow: hidden;
      font-family: Arial, Helvetica, sans-serif;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
      background: #fff;
    }
    @media print { body { width: 6in; height: 4in; } }
  </style>
</head>
<body onload="setTimeout(function(){window.print();},${printDelayMs})">
  <div style="width:6in;height:4in;display:flex;flex-direction:column;border:4px solid #000;background:#fff;color:#000;position:relative;overflow:hidden;">

    <!-- Header -->
    <div style="height:.62in;display:flex;align-items:stretch;justify-content:space-between;border-bottom:4px solid #000;background:#fff;">
      <div style="display:flex;align-items:center;padding:0 .22in;font-size:13pt;font-weight:900;text-transform:uppercase;letter-spacing:.18em;line-height:1;color:#111;">
        Thank-you label
      </div>
      <div style="display:flex;align-items:center;background:#000;color:#fff;padding:0 .2in;font-size:10pt;font-weight:900;text-transform:uppercase;letter-spacing:.14em;white-space:nowrap;">
        Scan for savings
      </div>
    </div>

    <!-- Body -->
    <div style="flex:1;display:grid;grid-template-columns:1fr 2.12in;gap:.2in;align-items:stretch;padding:.2in .22in .16in .22in;min-height:0;">

      <!-- Text column -->
      <div style="min-width:0;height:260px;max-height:100%;display:flex;flex-direction:column;justify-content:space-between;gap:.13in;">
        <div>
          <div style="font-size:30pt;font-weight:900;line-height:.9;letter-spacing:-.05em;text-transform:uppercase;">${headline}</div>
          <div style="width:1.05in;height:6px;background:#000;margin:.14in 0 .13in 0;"></div>
          <div style="font-size:15.5pt;font-weight:900;line-height:1.08;letter-spacing:-.015em;color:#111;">
            ${esc(cta1)}
          </div>
          <div style="font-size:11pt;margin-top:.06in;line-height:1.28;color:#444;font-weight:700;">
            ${esc(cta2)}
          </div>
        </div>

        <div style="border:4px solid #000;background:#fff;padding:.11in .15in;height:70px;display:inline-block;align-self:flex-start;box-shadow:.045in .045in 0 #222;margin-bottom:10px;">
          <div style="font-size:8pt;font-weight:900;text-transform:uppercase;letter-spacing:.18em;color:#444;margin-bottom:.035in;">${esc(rewardLabel)}</div>
          <div style="${rewardLineStyle}">${rewardLines.map(line => esc(line)).join("<br>")}</div>
        </div>
      </div>

      <!-- QR column -->
      <div style="border:4px solid #000;background:#fff;height:260px;display:flex;flex-direction:column;align-items:stretch;justify-content:space-between;min-width:0;">
        <div style="background:#000;color:#fff;text-align:center;font-size:11pt;font-weight:900;text-transform:uppercase;letter-spacing:.2em;padding:.08in .08in;">
          Scan me
        </div>
        <div style="display:flex;align-items:center;justify-content:center;height:160px;background:#fff;">
          <div style="border:0;background:#fff;">
            ${qrBlock}
          </div>
        </div>
        <div style="border-top:2px solid #000;font-size:8.5pt;color:#444;text-align:center;line-height:1.2;padding:.06in .08in;font-weight:900;text-transform:uppercase;letter-spacing:.12em;">
          karrykraze.com
        </div>
      </div>

    </div>

    <!-- Footer -->
    <div style="height:.36in;border-top:4px solid #000;background:#000;color:#fff;display:flex;align-items:center;justify-content:space-between;padding:0 .2in;font-size:8pt;font-weight:900;text-transform:uppercase;letter-spacing:.12em;">
      <span>${esc(footerLeft)}</span>
      <span style="display:inline-block;width:2px;height:.17in;background:#fff;margin:0 .12in;"></span>
      <span>${esc(footerRight)}</span>
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
