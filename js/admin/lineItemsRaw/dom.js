// /js/admin/lineItemsRaw/dom.js

export function $(id) {
  return document.getElementById(id);
}

export function show(el, on = true) {
  if (!el) return;
  el.classList.toggle("hidden", !on);
}

export function setMsg(el, msg, isError = false) {
  if (!el) return;
  el.textContent = msg || "";
  el.classList.toggle("hidden", !msg);
  el.classList.toggle("is-error", !!isError);
}

export function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function money(n) {
  const x = Number(n || 0);
  return `$${x.toFixed(2)}`;
}

export function centsToDollars(cents) {
  const c = Number(cents);
  if (!Number.isFinite(c)) return "";
  return (c / 100).toFixed(2);
}

export function dollarsToCents(dollars) {
  const d = Number(dollars);
  if (!Number.isFinite(d)) return null;
  return Math.round(d * 100);
}

export function formatDateShort(iso) {
  if (!iso) return "—";
  try {
    const dt = new Date(iso);
    if (Number.isNaN(dt.getTime())) return "—";
    return dt.toLocaleString(undefined, {
      year: "2-digit",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

export function toDatetimeLocalValue(iso) {
  // datetime-local expects "YYYY-MM-DDTHH:MM"
  if (!iso) return "";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  const y = dt.getFullYear();
  const m = pad(dt.getMonth() + 1);
  const d = pad(dt.getDate());
  const hh = pad(dt.getHours());
  const mm = pad(dt.getMinutes());
  return `${y}-${m}-${d}T${hh}:${mm}`;
}

export function fromDatetimeLocalValue(v) {
  if (!v) return null;
  // treat as local time and convert to ISO
  const dt = new Date(v);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
}
