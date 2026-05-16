let bulkMode = "price";

function getSelectedItems() {
  return [...document.querySelectorAll(".bulk-check:checked")].map(cb => ({
    code:    cb.dataset.code,
    offerId: cb.dataset.offer,
    sku:     cb.dataset.sku,
  }));
}

export function updateBulkBar() {
  const selected = getSelectedItems();
  const bar      = document.getElementById("bulkBar");
  if (selected.length > 0) {
    bar.classList.remove("hidden");
    bar.classList.add("flex");
    document.getElementById("bulkCount").textContent = `${selected.length} selected`;
  } else {
    bar.classList.add("hidden");
    bar.classList.remove("flex");
  }
}

function openBulkModal(mode) {
  bulkMode = mode;
  const selected = getSelectedItems();
  if (!selected.length) return;
  document.getElementById("bulkModalTitle").textContent = mode === "price" ? "Bulk Update Price" : "Bulk Update Quantity";
  document.getElementById("bulkModalLabel").textContent = mode === "price" ? "New Price ($)" : "New Quantity";
  document.getElementById("bulkModalValue").value       = "";
  document.getElementById("bulkModalValue").step        = mode === "price" ? "0.01" : "1";
  document.getElementById("bulkModalItems").textContent = selected.map(s => s.sku).join(", ");
  document.getElementById("bulkModalStatus").textContent = "";
  document.getElementById("bulkModal").classList.remove("hidden");
}

/**
 * Wire up all bulk-action event listeners.
 * @param {{ callEdge: Function, supabase: object, loadProducts: Function }} deps
 */
export function initBulkActions({ callEdge, supabase, loadProducts }) {
  // Checkbox change — update bulk bar
  document.addEventListener("change", (e) => {
    if (e.target.classList.contains("bulk-check")) updateBulkBar();
  });

  // Check-all toggle
  document.getElementById("checkAll").addEventListener("change", (e) => {
    document.querySelectorAll(".bulk-check").forEach(cb => { cb.checked = e.target.checked; });
    updateBulkBar();
  });

  // Cancel — clear all selections
  document.getElementById("btnBulkCancel").addEventListener("click", () => {
    document.querySelectorAll(".bulk-check").forEach(cb => { cb.checked = false; });
    document.getElementById("checkAll").checked = false;
    updateBulkBar();
  });

  // Open bulk price / qty modal
  document.getElementById("btnBulkPrice").addEventListener("click", () => openBulkModal("price"));
  document.getElementById("btnBulkQty").addEventListener("click",   () => openBulkModal("qty"));

  // Close bulk modal
  document.getElementById("btnCloseBulk").addEventListener("click", () => {
    document.getElementById("bulkModal").classList.add("hidden");
  });

  // Apply bulk update
  document.getElementById("btnBulkApply").addEventListener("click", async () => {
    const btn    = document.getElementById("btnBulkApply");
    const status = document.getElementById("bulkModalStatus");
    const value  = parseFloat(document.getElementById("bulkModalValue").value);
    if (isNaN(value) || value < 0) { status.textContent = "❌ Enter a valid number"; return; }

    const selected = getSelectedItems().filter(s => s.offerId);
    if (!selected.length) { status.textContent = "❌ No items with offers selected"; return; }

    btn.disabled = true; btn.textContent = "Updating...";

    try {
      const items = selected.map(s => ({
        sku:     s.sku,
        offerId: s.offerId,
        ...(bulkMode === "price" ? { priceCents: Math.round(value * 100) } : {}),
        ...(bulkMode === "qty"   ? { quantity:   Math.round(value) }       : {}),
      }));

      const result = await callEdge("ebay-manage-listing", { action: "bulk_update", items });
      if (result.success) {
        status.textContent = `✅ Updated ${selected.length} listings`;
        if (bulkMode === "price") {
          const priceCents = Math.round(value * 100);
          for (const s of selected) {
            await supabase.from("products").update({ ebay_price_cents: priceCents, updated_at: new Date().toISOString() }).eq("code", s.code);
          }
        }
        setTimeout(() => {
          document.getElementById("bulkModal").classList.add("hidden");
          document.querySelectorAll(".bulk-check").forEach(cb => { cb.checked = false; });
          document.getElementById("checkAll").checked = false;
          updateBulkBar();
          loadProducts();
        }, 1200);
      } else {
        status.textContent = "❌ " + (result.error || "Bulk update failed");
      }
    } catch (e) {
      status.textContent = "❌ " + e.message;
    } finally {
      btn.disabled = false; btn.textContent = "Apply to All Selected";
    }
  });
}
