export function $(id) {
  return document.getElementById(id);
}

export function show(el, yes) {
  if (!el) return;
  el.classList.toggle("hidden", !yes);
}

export function setMsg(el, msg, showIt = true) {
  if (!el) return;
  el.textContent = msg || "";
  el.classList.toggle("hidden", !showIt || !msg);
}

export function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (m) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]
  ));
}

export function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, "&quot;");
}

export function normalizeSlug(s) {
  return (s || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

export function money(n) {
  const num = Number(n || 0);
  return num.toLocaleString(undefined, { style: "currency", currency: "USD" });
}
