// /js/admin/lineItemsOrders/shipReadyCsv.js
import { gramsToOz } from "./dom.js";

function csvEsc(v) {
  const s = String(v ?? "");
  const needs = /[,"\n]/.test(s);
  const out = s.replaceAll('"', '""');
  return needs ? `"${out}"` : out;
}

function ozFromG(g) {
  const oz = gramsToOz(g);
  return oz == null ? "" : oz.toFixed(1);
}

export function downloadShipReadyCSV(rows, { filenamePrefix = "ship-ready" } = {}) {
  const now = new Date();
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const filename = `${filenamePrefix}-${stamp}.csv`;

  // Pirate Ship can accept many formats; we’ll keep yours + add a few useful shipment fields.
  const header = [
    "date",
    "kk_order_id",
    "first_name",
    "last_name",
    "street_address",
    "city",
    "state",
    "zip",
    "country",
    "email",
    "total_items",
    "total_weight_oz",
    "total_paid",
    "label_status",
    "batch_id",
    "printed_at",
    "tracking_number",
    "notes",
  ];

  const lines = [header.join(",")];

  for (const r of rows || []) {
    const ship = r.shipment || {};
    const wG = r.total_weight_g ?? r.li_total_weight_g ?? "";
    const paidCents = r.total_paid_cents ?? "";

    const row = [
      (r.order_date || "").slice(0, 10),
      r.kk_order_id || "",
      r.first_name || "",
      r.last_name || "",
      r.street_address || "",
      r.city || "",
      r.state || "",
      r.zip || "",
      r.country || "",
      r.email || "",
      r.total_items ?? r.li_total_items ?? "",
      ozFromG(wG),
      paidCents !== "" ? (Number(paidCents) / 100).toFixed(2) : "",
      ship.label_status || "pending",
      ship.batch_id || "",
      ship.printed_at || "",
      ship.tracking_number || "",
      ship.notes || "",
    ];

    lines.push(row.map(csvEsc).join(","));
  }

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}
