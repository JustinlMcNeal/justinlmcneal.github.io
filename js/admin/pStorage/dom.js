export function getEls() {
  return {
    // header status
    statusEl: document.getElementById("ps_status"),

    // controls
    searchInput: document.getElementById("searchInput"),
    btnNew: document.getElementById("btnNew"),
    countLabel: document.getElementById("countLabel"),

    // table
    storageRows: document.getElementById("storageRows"),

    // modal
    modal: document.getElementById("modal"),
    modalTitle: document.getElementById("modalTitle"),
    btnClose: document.getElementById("btnClose"),
    modalMsg: document.getElementById("modalMsg"),

    btnSave: document.getElementById("btnSave"),
    btnArchive: document.getElementById("btnArchive"),
    btnHardDelete: document.getElementById("btnHardDelete"),

    fId: document.getElementById("fId"),
    fName: document.getElementById("fName"),
    fProductId: document.getElementById("fProductId"),
    fUrl: document.getElementById("fUrl"),
    fStage: document.getElementById("fStage"),
    fTags: document.getElementById("fTags"),

    fTargetPrice: document.getElementById("fTargetPrice"),
    fUnitCost: document.getElementById("fUnitCost"),
    fWeightG: document.getElementById("fWeightG"),
    fSupplierShip: document.getElementById("fSupplierShip"),
    fStcc: document.getElementById("fStcc"),
    fBulkQty: document.getElementById("fBulkQty"),

    fNotes: document.getElementById("fNotes"),
  };
}

export function setStatus(els, msg) {
  if (els?.statusEl) els.statusEl.textContent = msg;
}

export function show(el) { el?.classList.remove("hidden"); }
export function hide(el) { el?.classList.add("hidden"); }

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

export function splitTags(s) {
  const raw = String(s ?? "").trim();
  if (!raw) return null;
  const arr = raw.split(",").map(x => x.trim()).filter(Boolean);
  return arr.length ? arr : null;
}

export function joinTags(arr) {
  return Array.isArray(arr) ? arr.join(", ") : "";
}

export function numOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function intOrNull(v) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}
