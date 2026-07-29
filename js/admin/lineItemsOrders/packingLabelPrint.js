// /js/admin/lineItemsOrders/packingLabelPrint.js
// Decorative thank-you packing insert (static artwork) — 4×6 thermal.

export const PACKING_LABEL_SRC = "/imgs/packing-label.png";

/** 4×6 packing sticker sheet (div only). */
export function buildPackingLabelSheet(src = PACKING_LABEL_SRC) {
  const safe = escAttr(src);
  return `<div style="width:4in;height:6in;display:flex;align-items:center;justify-content:center;background:#fff;overflow:hidden;">
  <img src="${safe}" alt="Karry Kraze packing label" style="width:4in;height:6in;object-fit:contain;display:block;">
</div>`;
}

/**
 * Open a print window with the Karry Kraze packing insert artwork.
 * Same 4×6 thermal pattern as Shippo PNG shipping labels.
 */
export function printPackingLabel() {
  const pw = window.open("", "printPackingLabel", "width=500,height=750");
  if (!pw) {
    return { ok: false, message: "Popup blocked — please allow popups for this site." };
  }

  const sheet = buildPackingLabelSheet();
  pw.document.open();
  pw.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>Packing Label</title>
  <style>
    @page { size: 4in 6in; margin: 0; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #222; }
    @media print { body { background: #fff; min-height: 0; } }
  </style>
</head>
<body>
  ${sheet}
  <script>
    (function () {
      var img = document.querySelector("img");
      function go() { setTimeout(function () { window.print(); }, 400); }
      if (img && !img.complete) img.onload = go;
      else go();
      if (img) img.onerror = function () {
        document.body.innerHTML = '<p style="color:#fff;font-family:sans-serif;padding:1rem">Failed to load packing label image.</p>';
      };
    })();
  </script>
</body>
</html>`);
  pw.document.close();
  return { ok: true, message: "Packing label sent to printer." };
}

function escAttr(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}
