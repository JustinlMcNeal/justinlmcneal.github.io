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

export function money(n) {
  const num = Number(n || 0);
  return num.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

export function formatDate(isoString) {
  if (!isoString) return "—";
  const date = new Date(isoString);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function getPromotionTypeLabel(type) {
  const labels = {
    percentage: "% Off",
    fixed: "$ Off",
    bogo: "BOGO",
    "free-shipping": "Free Ship",
  };
  return labels[type] || type;
}
