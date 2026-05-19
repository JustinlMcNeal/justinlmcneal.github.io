// /js/admin/lineItemsOrders/workspaceLabels.js
// Renders the read-only CTA Labels tab for the order workspace.
import { sh, fmtDate } from "./workspaceUtils.js";
import { esc, getOrderSource } from "./dom.js";
import { determineLabelType } from "./labelPrint.js";

const TRACKING_BASE_URL = "https://karrykraze.com/r/?t=";

function sourceLabel(source) {
  if (source === "kk") return "KK";
  if (source === "ebay") return "eBay";
  if (source === "amazon") return "Amazon";
  return "Unknown";
}

function labelTypeLabel(labelType) {
  if (labelType === "review_cta") return "Review CTA";
  if (labelType === "channel_cta") return "Channel CTA";
  return "None";
}

function couponFor(labelType) {
  if (labelType === "review_cta") return "THANKYOU15";
  if (labelType === "channel_cta") return "DIRECT15";
  return null;
}

function parseMetadata(metadata) {
  if (!metadata) return {};
  if (typeof metadata === "object") return metadata;
  if (typeof metadata !== "string") return {};
  try {
    return JSON.parse(metadata);
  } catch {
    return {};
  }
}

function shortId(id) {
  const s = String(id || "").trim();
  if (!s) return "-";
  if (s.length <= 12) return s;
  return `${s.slice(0, 8)}...${s.slice(-4)}`;
}

function trackingUrlFor(link) {
  return link?.token ? `${TRACKING_BASE_URL}${encodeURIComponent(link.token)}` : null;
}

function latestScanForPrint(history, print, link) {
  const direct = print?.id ? history?.latestScanByPrintId?.[print.id] : null;
  const viaLink = link?.id ? history?.latestScanByLinkId?.[link.id] : null;
  if (!direct) return viaLink || null;
  if (!viaLink) return direct;
  return new Date(direct.scanned_at || 0) > new Date(viaLink.scanned_at || 0) ? direct : viaLink;
}

function scanCountForPrint(history, print, link) {
  const printCount = print?.id ? Number(history?.scanCountsByPrintId?.[print.id] || 0) : 0;
  const linkCount = link?.id ? Number(history?.scanCountsByLinkId?.[link.id] || 0) : 0;
  return Math.max(printCount, linkCount);
}

function summaryCard(label, value, helper = "") {
  return `<div class="border-4 border-black p-4">
    <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">${esc(label)}</div>
    <div class="font-black text-lg">${esc(value)}</div>
    ${helper ? `<div class="text-[9px] text-black/45 mt-1">${esc(helper)}</div>` : ""}
  </div>`;
}

function emptyState(message) {
  return `<div class="border-4 border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
    ${esc(message)}
  </div>`;
}

function renderLinkRow(link, history) {
  const url = trackingUrlFor(link);
  const scans = Number(history?.scanCountsByLinkId?.[link.id] || 0);
  const latestScan = history?.latestScanByLinkId?.[link.id] || null;
  const meta = parseMetadata(link?.metadata);
  const destination = link?.destination_url || meta.qr_target || "-";

  return `<div class="border-4 border-black p-4">
    <div class="grid lg:grid-cols-[1fr_auto] gap-3">
      <div class="min-w-0">
        <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">Tracking URL</div>
        ${
          url
            ? `<a href="${esc(url)}" target="_blank" rel="noopener" class="font-mono text-xs break-all text-kkpink hover:underline">${esc(url)}</a>`
            : '<div class="font-mono text-xs text-gray-400">No token</div>'
        }
      </div>
      ${
        url
          ? `<button type="button" data-copy="${esc(url)}"
            class="self-start border-4 border-black bg-white px-3 py-1 text-[10px] font-black uppercase tracking-wider hover:bg-black hover:text-white transition-colors">
            Copy
          </button>`
          : ""
      }
    </div>
    <div class="mt-3 grid sm:grid-cols-3 gap-3 text-xs">
      <div>
        <div class="text-[9px] font-black uppercase tracking-[.18em] text-black/50">Token</div>
        <div class="font-mono">${esc(shortId(link?.token))}</div>
      </div>
      <div>
        <div class="text-[9px] font-black uppercase tracking-[.18em] text-black/50">Scans</div>
        <div class="font-black">${esc(scans)}</div>
      </div>
      <div>
        <div class="text-[9px] font-black uppercase tracking-[.18em] text-black/50">Latest Scan</div>
        <div>${esc(fmtDate(latestScan?.scanned_at))}</div>
      </div>
    </div>
    <div class="mt-3">
      <div class="text-[9px] font-black uppercase tracking-[.18em] text-black/50">Destination</div>
      <div class="font-mono text-xs break-all">${esc(destination)}</div>
    </div>
  </div>`;
}

function renderPrintRow(print, history) {
  const links = history?.linksByPrintId?.[print.id] || [];
  const link = links[0] || null;
  const printMeta = parseMetadata(print?.metadata);
  const linkMeta = parseMetadata(link?.metadata);
  const destination = link?.destination_url || linkMeta.qr_target || printMeta.qr_target || "-";
  const labelType = print?.label_type || link?.label_type || "none";
  const coupon = printMeta.coupon || linkMeta.coupon || couponFor(labelType) || "-";
  const scanCount = scanCountForPrint(history, print, link);
  const latestScan = latestScanForPrint(history, print, link);

  return `<div class="border-4 border-black p-4">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div class="font-black text-sm uppercase tracking-[.08em]">${esc(labelTypeLabel(labelType))}</div>
        <div class="text-xs text-gray-500 mt-1">Printed ${esc(fmtDate(print?.printed_at))}</div>
      </div>
      <div class="text-right">
        <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60">Scans</div>
        <div class="font-black text-lg">${esc(scanCount)}</div>
      </div>
    </div>
    <div class="mt-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
      <div>
        <div class="text-[9px] font-black uppercase tracking-[.18em] text-black/50">Source</div>
        <div class="font-black">${esc(sourceLabel(print?.order_source))}</div>
      </div>
      <div>
        <div class="text-[9px] font-black uppercase tracking-[.18em] text-black/50">Coupon</div>
        <div class="font-mono">${esc(coupon)}</div>
      </div>
      <div>
        <div class="text-[9px] font-black uppercase tracking-[.18em] text-black/50">Latest Scan</div>
        <div>${esc(fmtDate(latestScan?.scanned_at))}</div>
      </div>
      <div>
        <div class="text-[9px] font-black uppercase tracking-[.18em] text-black/50">Print</div>
        <div class="font-mono">${esc(shortId(print?.id))}</div>
      </div>
    </div>
    <div class="mt-3">
      <div class="text-[9px] font-black uppercase tracking-[.18em] text-black/50">Destination</div>
      <div class="font-mono text-xs break-all">${esc(destination)}</div>
    </div>
  </div>`;
}

export function renderLabels(order, history = {}) {
  const source = getOrderSource(order);
  const expectedLabelType = determineLabelType(source);
  const eligible = expectedLabelType !== "none" && !(source === "kk" && !order?.kk_order_id);
  const prints = history?.prints || [];
  const links = history?.links || [];
  const scans = history?.scans || [];
  const latestScan = scans[0] || null;
  const trackingActive = links.some((link) => Boolean(link?.token));
  const error = history?.error || null;

  let html = '<div class="p-3 sm:p-6 space-y-6">';

  html += `<section>
    ${sh("CTA Label Status")}
    ${
      error
        ? `<div class="mb-4 border-4 border-red-300 bg-red-50 p-4 text-sm text-red-700">
          CTA label history could not be loaded: ${esc(error)}
        </div>`
        : ""
    }
    <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
      ${summaryCard("Source", sourceLabel(source), "Order channel")}
      ${summaryCard("Label Type", labelTypeLabel(expectedLabelType), eligible ? "Current CTA rule" : "No CTA label")}
      ${summaryCard("Eligibility", eligible ? "Eligible" : "Not Eligible", eligible ? "Read-only history" : "KK website and eBay only")}
      ${summaryCard("Scan Tracking", trackingActive ? "Active" : "Inactive", `${scans.length} total scan${scans.length === 1 ? "" : "s"}`)}
    </div>
  </section>
  <div class="border-t-4 border-gray-100"></div>`;

  html += `<section>
    ${sh("Print History")}
    ${
      prints.length
        ? `<div class="space-y-3">${prints.map((print) => renderPrintRow(print, history)).join("")}</div>`
        : emptyState(
            eligible
              ? "No CTA labels printed for this order yet. Use Print CTA Label in the Fulfillment tab to create one."
              : "CTA labels are currently enabled for KK website and eBay orders only."
          )
    }
  </section>
  <div class="border-t-4 border-gray-100"></div>`;

  html += `<section>
    ${sh("Scan Summary")}
    <div class="grid sm:grid-cols-3 gap-4">
      ${summaryCard("Total Scans", String(scans.length), "Across all CTA links for this order")}
      ${summaryCard("Latest Scan", fmtDate(latestScan?.scanned_at), "Raw IP and user agent are hidden")}
      ${summaryCard("Tracking Links", String(links.length), trackingActive ? "Token redirects available" : "No active token")}
    </div>
  </section>
  <div class="border-t-4 border-gray-100"></div>`;

  html += `<section>
    ${sh("Link Tokens")}
    ${
      links.length
        ? `<div class="space-y-3">${links.map((link) => renderLinkRow(link, history)).join("")}</div>`
        : emptyState("No tracking links have been created for this order yet.")
    }
  </section>`;

  html += "</div>";
  return html;
}
