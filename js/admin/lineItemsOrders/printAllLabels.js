// /js/admin/lineItemsOrders/printAllLabels.js
// One print job: CTA insert + packing sticker + shipping label (when available).
import { buildCtaLabelSheet, buildQrTarget, generateQrDataUrlForTarget } from "./labelPrint.js";
import { getCtaEligibility } from "./ctaPrintFlow.js";
import { trackCtaLabelPrint, createCtaLabelLink, getSignedLabelUrl } from "./api.js";
import { buildPackingLabelSheet, PACKING_LABEL_SRC } from "./packingLabelPrint.js";

/**
 * Resolve CTA QR URL with the same tracking/link flow as Print CTA Label.
 * @returns {Promise<{ included: boolean, sheetHtml?: string, note?: string, trackingFailed?: boolean, linkCreated?: boolean }>}
 */
async function prepareCtaSheet(order) {
  const eligibility = getCtaEligibility(order);
  if (!eligibility.eligible) {
    return { included: false, note: eligibility.message || "CTA skipped" };
  }

  const { source, labelType } = eligibility;
  const qrTarget = buildQrTarget(order, source, labelType);
  let finalUrl = qrTarget;
  let trackingFailed = false;
  let linkCreated = false;

  try {
    const trackResult = await trackCtaLabelPrint({
      sessionId: order.stripe_checkout_session_id,
      kkOrderId: order.kk_order_id || null,
      orderSource: source,
      labelType,
      metadata: { qr_target: qrTarget, print_all: true },
    });

    if (trackResult.ok) {
      const linkResult = await createCtaLabelLink({
        printId: trackResult.id,
        sessionId: order.stripe_checkout_session_id,
        kkOrderId: order.kk_order_id || null,
        orderSource: source,
        labelType,
        destinationUrl: qrTarget,
        metadata: { qr_target: qrTarget, print_all: true },
      });
      if (linkResult.ok) {
        finalUrl = linkResult.trackingUrl;
        linkCreated = true;
      } else {
        trackingFailed = true;
      }
    } else {
      trackingFailed = true;
    }
  } catch (err) {
    trackingFailed = true;
    console.warn("[printAllLabels] CTA tracking failed:", err);
  }

  const qrDataUrl = await generateQrDataUrlForTarget(finalUrl);
  const sheetHtml = buildCtaLabelSheet(order, labelType, {
    qrDataUrl,
    qrFallbackUrl: finalUrl,
  });

  return { included: true, sheetHtml, trackingFailed, linkCreated };
}

async function prepareShippingSheet(shipment) {
  if (!shipment?.label_url) {
    return { included: false, note: "No shipping label purchased yet" };
  }

  try {
    const url = await getSignedLabelUrl(shipment.label_url);
    const isPng = String(shipment.label_url).toLowerCase().endsWith(".png");
    if (!isPng) {
      return {
        included: false,
        note: "Shipping label is PDF — print it with Print Label separately",
        openUrl: url,
      };
    }
    const safe = escAttr(url);
    return {
      included: true,
      sheetHtml: `<div style="width:4in;height:6in;display:flex;align-items:center;justify-content:center;background:#fff;overflow:hidden;">
  <img src="${safe}" alt="Shipping label" data-await-img style="width:4in;height:6in;object-fit:contain;display:block;">
</div>`,
    };
  } catch (err) {
    return { included: false, note: "Shipping label failed: " + (err.message || String(err)) };
  }
}

function buildCombinedHtml(pages) {
  const sheets = pages
    .map(
      (p, i) =>
        `<div class="sheet sheet-${escAttr(p.kind)}"${i < pages.length - 1 ? "" : " data-last"}>${p.html}</div>`
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Print All Labels</title>
  <style>
    @page { margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #222;
      font-family: Arial, Helvetica, sans-serif;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .sheet {
      page-break-after: always;
      break-after: page;
      display: flex;
      justify-content: center;
      align-items: center;
      background: #fff;
    }
    .sheet[data-last] { page-break-after: auto; break-after: auto; }
    .sheet-cta { width: 6in; min-height: 4in; }
    .sheet-packing, .sheet-shipping { width: 4in; min-height: 6in; }
    @media print {
      body { background: #fff; }
      .sheet { background: #fff; }
    }
  </style>
</head>
<body>
  ${sheets}
  <script>
    (function () {
      var imgs = Array.prototype.slice.call(document.querySelectorAll("img"));
      var pending = imgs.filter(function (img) { return !img.complete; }).length;
      function go() { setTimeout(function () { window.print(); }, 500); }
      if (!pending) { go(); return; }
      imgs.forEach(function (img) {
        if (img.complete) return;
        img.addEventListener("load", function () { pending -= 1; if (pending <= 0) go(); });
        img.addEventListener("error", function () { pending -= 1; if (pending <= 0) go(); });
      });
    })();
  </script>
</body>
</html>`;
}

/**
 * Print CTA + packing + shipping labels in one dialog when possible.
 * Opens the print window synchronously (call from a click handler).
 *
 * @param {object} order
 * @param {object|null} shipment
 * @param {{ buttonEl?: HTMLButtonElement }} [opts]
 */
export async function printAllLabels(order, shipment, { buttonEl } = {}) {
  const pw = window.open("", "kkPrintAllLabels", "width=520,height=780");
  if (!pw) {
    return { ok: false, message: "Popup blocked — please allow popups for this site.", isError: true };
  }

  pw.document.write(
    "<!DOCTYPE html><html><head><title>Preparing labels…</title></head>" +
      '<body style="font-family:sans-serif;padding:20px;font-size:13px;">Preparing labels…</body></html>'
  );
  pw.document.close();

  const origText = buttonEl?.textContent?.trim();
  if (buttonEl) {
    buttonEl.disabled = true;
    buttonEl.textContent = "Preparing…";
  }

  const notes = [];
  const pages = [];

  try {
    const cta = await prepareCtaSheet(order);
    if (cta.included) {
      pages.push({ kind: "cta", html: cta.sheetHtml });
      if (cta.trackingFailed) notes.push("CTA scan tracking unavailable");
    } else if (cta.note) {
      notes.push("CTA: " + cta.note);
    }

    pages.push({
      kind: "packing",
      html: buildPackingLabelSheet(PACKING_LABEL_SRC),
    });

    const ship = await prepareShippingSheet(shipment);
    if (ship.included) {
      pages.push({ kind: "shipping", html: ship.sheetHtml });
    } else if (ship.note) {
      notes.push("Shipping: " + ship.note);
      if (ship.openUrl) {
        // Best-effort: open PDF label in a second tab so operator can still print it.
        try {
          window.open(ship.openUrl, "_blank", "noopener");
        } catch {
          /* ignore */
        }
      }
    }

    if (!pages.length) {
      pw.close();
      return { ok: false, message: "Nothing to print.", isError: true };
    }

    if (pw.closed) {
      return { ok: false, message: "Print window was closed.", isError: true };
    }

    const html = buildCombinedHtml(pages);
    pw.document.open();
    pw.document.write(html);
    pw.document.close();

    const printed = pages.map((p) => p.kind).join(" + ");
    const suffix = notes.length ? " (" + notes.join("; ") + ")" : "";
    return {
      ok: true,
      message: `Print All opened: ${printed}.${suffix}`,
      isError: false,
      ctaPrinted: pages.some((p) => p.kind === "cta"),
    };
  } catch (err) {
    try {
      pw.close();
    } catch {
      /* ignore */
    }
    return {
      ok: false,
      message: "Print All failed: " + (err.message || String(err)),
      isError: true,
    };
  } finally {
    if (buttonEl) {
      buttonEl.disabled = false;
      buttonEl.textContent = origText || "Print All";
    }
  }
}

function escAttr(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}
