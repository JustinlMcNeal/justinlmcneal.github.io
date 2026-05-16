import { esc } from "./utils.js";

/**
 * Renders migrate/import results into #migrateResults / #migrateBody.
 * @param {Array} items
 */
function renderMigrateResults(items) {
  const panel = document.getElementById("migrateResults");
  const tbody = document.getElementById("migrateBody");
  if (!items.length) { panel.classList.add("hidden"); return; }
  tbody.innerHTML = items.map(item => `
    <tr class="border-b border-gray-100">
      <td class="py-1 pr-2 font-mono">${esc(item.sku)}</td>
      <td class="py-1 pr-2">${esc(item.title)}</td>
      <td class="py-1 pr-2">${item.quantity ?? "—"}</td>
      <td class="py-1 ${item.matchedCode || item.code ? "text-green-600 font-bold" : "text-red-400"}">${esc(item.matchedCode || item.code || "—")}</td>
    </tr>
  `).join("");
  panel.classList.remove("hidden");
}

/**
 * Wire up the Import / Migration panel event listeners.
 * @param {{ callEdge: Function, loadProducts: Function }} deps
 */
export function initImportPanel({ callEdge, loadProducts }) {
  // Toggle panel visibility
  document.getElementById("btnMigrate").addEventListener("click", () => {
    document.getElementById("migratePanel").classList.toggle("hidden");
  });

  // Scan existing eBay inventory
  document.getElementById("btnScanEbay").addEventListener("click", async () => {
    const btn    = document.getElementById("btnScanEbay");
    const status = document.getElementById("migrateStatus");
    btn.disabled = true; btn.textContent = "Scanning..."; status.textContent = "";
    try {
      const result = await callEdge("ebay-migrate-listings", { action: "scan" });
      if (result.success) {
        status.textContent = `Found ${result.total} items — ${result.matched} matched, ${result.unmatched} unmatched`;
        renderMigrateResults(result.items || []);
      } else {
        status.textContent = "❌ " + (result.error || "Scan failed");
      }
    } catch (e) { status.textContent = "❌ " + e.message; }
    finally { btn.disabled = false; btn.textContent = "🔍 Scan eBay Inventory"; }
  });

  // Auto-link all matchable eBay items to KK products
  document.getElementById("btnAutoLink").addEventListener("click", async () => {
    if (!confirm("Auto-link all matchable eBay items to KK products?")) return;
    const btn    = document.getElementById("btnAutoLink");
    const status = document.getElementById("migrateStatus");
    btn.disabled = true; btn.textContent = "Linking..."; status.textContent = "";
    try {
      const result = await callEdge("ebay-migrate-listings", { action: "auto_link" });
      if (result.success) {
        status.textContent = `✅ Linked ${result.linked} of ${result.total} items (${result.skippedNoMatch} unmatched)`;
        renderMigrateResults(result.results || []);
        loadProducts();
      } else {
        status.textContent = "❌ " + (result.error || "Auto-link failed");
      }
    } catch (e) { status.textContent = "❌ " + e.message; }
    finally { btn.disabled = false; btn.textContent = "⚡ Auto-Link All"; }
  });
}
