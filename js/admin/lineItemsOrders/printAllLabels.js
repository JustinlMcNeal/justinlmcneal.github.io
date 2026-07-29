// /js/admin/lineItemsOrders/printAllLabels.js
// One print window: CTA rasterized+rotated onto 4×6, then packing + shipping (all 4×6).
import { buildCtaLabelSheet, buildQrTarget, generateQrDataUrlForTarget } from "./labelPrint.js";
import { getCtaEligibility } from "./ctaPrintFlow.js";
import { trackCtaLabelPrint, createCtaLabelLink, getSignedLabelUrl } from "./api.js";
import { buildPackingLabelSheet, PACKING_LABEL_SRC } from "./packingLabelPrint.js";

let _html2canvas = null;

async function loadHtml2Canvas() {
  if (_html2canvas) return _html2canvas;
  const mod = await import("https://esm.sh/html2canvas@1.4.1");
  _html2canvas = mod.default ?? mod;
  return _html2canvas;
}

/**
 * Rasterize CTA HTML (6×4) and rotate 90° CW onto a 4×6 bitmap (no CSS print transforms).
 * @returns {Promise<string|null>} PNG data URL
 */
async function ctaSheetToThermalDataUrl(sheetHtml) {
  const html2canvas = await loadHtml2Canvas();
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText =
    "position:fixed;left:-12000px;top:0;width:6in;height:4in;overflow:hidden;background:#fff;z-index:-1;";
  host.innerHTML = sheetHtml;
  document.body.appendChild(host);

  const target = host.firstElementChild || host;
  try {
    // Wait a tick so QR <img> data URLs can decode
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const qrImg = target.querySelector("img");
    if (qrImg && !qrImg.complete) {
      await new Promise((resolve) => {
        qrImg.onload = resolve;
        qrImg.onerror = resolve;
        setTimeout(resolve, 1500);
      });
    }

    const src = await html2canvas(target, {
      backgroundColor: "#ffffff",
      scale: 2,
      useCORS: true,
      logging: false,
      width: target.offsetWidth || undefined,
      height: target.offsetHeight || undefined,
    });

    // 6×4 landscape → 4×6 portrait
    const dst = document.createElement("canvas");
    dst.width = src.height;
    dst.height = src.width;
    const ctx = dst.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, dst.width, dst.height);
    ctx.translate(dst.width, 0);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(src, 0, 0);

    return dst.toDataURL("image/png");
  } finally {
    host.remove();
  }
}

async function prepareCtaThermalImg(order) {
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

  const dataUrl = await ctaSheetToThermalDataUrl(sheetHtml);
  if (!dataUrl) {
    return { included: false, note: "CTA rasterize failed" };
  }

  return {
    included: true,
    html: `<img class="fill-img" src="${dataUrl}" alt="CTA label">`,
    trackingFailed,
    linkCreated,
  };
}

async function prepareShippingImg(shipment) {
  if (!shipment?.label_url) {
    return { included: false, note: "No shipping label purchased yet" };
  }

  try {
    const url = await getSignedLabelUrl(shipment.label_url);
    if (!String(shipment.label_url).toLowerCase().endsWith(".png")) {
      return {
        included: false,
        note: "Shipping label is PDF — print it with Print Label separately",
        openUrl: url,
      };
    }
    return {
      included: true,
      html: `<img class="fill-img" src="${escAttr(url)}" alt="Shipping label">`,
    };
  } catch (err) {
    return { included: false, note: "Shipping label failed: " + (err.message || String(err)) };
  }
}

function buildThermalHtml(pages) {
  const sheets = pages
    .map((p, i) => {
      const last = i === pages.length - 1 ? " data-last" : "";
      return `<div class="sheet"${last}>${p.html}</div>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Print All Labels</title>
  <style>
    @page { size: 4in 6in; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: 4in;
      margin: 0;
      padding: 0;
      background: #fff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .sheet {
      width: 4in;
      height: 6in;
      margin: 0;
      padding: 0;
      overflow: hidden;
      background: #fff;
      page-break-after: always;
      break-after: page;
      page-break-inside: avoid;
    }
    .sheet[data-last] {
      page-break-after: auto;
      break-after: auto;
    }
    .fill-img {
      display: block;
      width: 4in;
      height: 6in;
      object-fit: contain;
      object-position: center;
      background: #fff;
    }
    @media screen {
      html, body {
        width: auto;
        min-height: 100%;
        background: #222;
        padding: 16px 0;
      }
      .sheet {
        margin: 0 auto 20px;
        outline: 1px solid #555;
        box-shadow: 0 8px 24px rgba(0,0,0,.45);
      }
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
 * Print CTA + packing + shipping in one 4×6 print dialog.
 * Opens the print window synchronously (call from a click handler).
 */
export async function printAllLabels(order, shipment, { buttonEl } = {}) {
  const pw = window.open("", "kkPrintAllLabels", "width=420,height=720");
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
  let ctaPrinted = false;

  try {
    const cta = await prepareCtaThermalImg(order);
    if (cta.included) {
      pages.push({ kind: "cta", html: cta.html });
      ctaPrinted = true;
      if (cta.trackingFailed) notes.push("CTA scan tracking unavailable");
    } else if (cta.note) {
      notes.push("CTA: " + cta.note);
    }

    pages.push({
      kind: "packing",
      html: buildPackingLabelSheet(PACKING_LABEL_SRC),
    });

    const ship = await prepareShippingImg(shipment);
    if (ship.included) {
      pages.push({ kind: "shipping", html: ship.html });
    } else if (ship.note) {
      notes.push("Shipping: " + ship.note);
      if (ship.openUrl) {
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

    pw.document.open();
    pw.document.write(buildThermalHtml(pages));
    pw.document.close();

    const suffix = notes.length ? " (" + notes.join("; ") + ")" : "";
    return {
      ok: true,
      message: `Print All opened: ${pages.map((p) => p.kind).join(" + ")}.${suffix}`,
      isError: false,
      ctaPrinted,
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
