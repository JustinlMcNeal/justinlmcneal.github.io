// /js/admin/customers/modalCustomer.js
function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function fmtDate(d) {
  if (!d) return "—";
  try { return new Date(d).toLocaleString(); }
  catch { return String(d); }
}

function moneyFromCents(cents) {
  const n = Number(cents || 0) / 100;
  return `$${n.toFixed(2)}`;
}

export function openCustomerModal(els) {
  els.customerModal?.classList.remove("hidden");
  els.customerModal?.setAttribute("aria-hidden", "false");
}

export function closeCustomerModal(els) {
  els.customerModal?.classList.add("hidden");
  els.customerModal?.setAttribute("aria-hidden", "true");
}

export function fillCustomerModal(els, summary) {
  const s = summary || {};

  const name = `${(s.first_name || "").trim()} ${(s.last_name || "").trim()}`.trim() || "Customer Details";
  els.modalCustomerName.textContent = name;
  els.modalCustomerEmail.textContent = s.email || "—";

  // Fill inputs (prefer summary values)
  els.fFirstName.value = s.first_name || "";
  els.fLastName.value = s.last_name || "";
  els.fEmail.value = s.email || "";
  els.fPhone.value = s.phone || "";

  els.fStreet.value = s.street_address || "";
  els.fCity.value = s.city || "";
  els.fState.value = s.state || "";
  els.fZip.value = s.zip || "";

  // Clear history
  if (els.customerOrdersRows) els.customerOrdersRows.innerHTML = "";
}

export function readCustomerForm(els) {
  return {
    email: (els.fEmail?.value || "").trim(),
    first_name: (els.fFirstName?.value || "").trim(),
    last_name: (els.fLastName?.value || "").trim(),
    phone: (els.fPhone?.value || "").trim(),

    street_address: (els.fStreet?.value || "").trim(),
    city: (els.fCity?.value || "").trim(),
    state: (els.fState?.value || "").trim(),
    zip: (els.fZip?.value || "").trim(),

    // optional future fields if you add them:
    country: null,
    stripe_customer_id: null,
    notes: null
  };
}

export function setModalBusy(els, busy, msg = "") {
  if (els.btnSaveCustomer) els.btnSaveCustomer.disabled = !!busy;
  if (els.btnCancelCustomer) els.btnCancelCustomer.disabled = !!busy;
  if (els.btnCloseCustomer) els.btnCloseCustomer.disabled = !!busy;

  // Show/hide modalMsg and set content
  if (els.modalMsg) {
    if (msg) {
      els.modalMsg.textContent = msg;
      els.modalMsg.classList.remove("hidden");
    } else {
      els.modalMsg.textContent = "";
      els.modalMsg.classList.add("hidden");
    }
  } else {
    // fallback: show status in header email line if no modalMsg element exists
    if (msg) els.modalCustomerEmail.textContent = msg;
  }
}

export function renderOrderHistory(els, orders) {
  if (!els.customerOrdersRows) return;

  if (!orders?.length) {
    els.customerOrdersRows.innerHTML = `
      <tr><td colspan="5" class="px-3 py-4 text-gray-500 text-center">No orders found.</td></tr>
    `;
    return;
  }

  els.customerOrdersRows.innerHTML = orders.map(o => {
    const date = esc(fmtDate(o.order_date));
    const kk = esc(o.kk_order_id || "—");
    const items = Number(o.total_items || 0);
    const total = esc(moneyFromCents(o.total_paid_cents));
    const status = esc(o.label_status || "—");
    
    // Status badge color
    const statusLower = status.toLowerCase();
    let badgeClass = "bg-gray-100 text-gray-600";
    if (statusLower.includes("delivered") || statusLower.includes("complete")) {
      badgeClass = "bg-green-100 text-green-700";
    } else if (statusLower.includes("transit") || statusLower.includes("shipped")) {
      badgeClass = "bg-blue-100 text-blue-700";
    } else if (statusLower.includes("cancel") || statusLower.includes("fail")) {
      badgeClass = "bg-red-100 text-red-700";
    }

    return `
      <tr class="hover:bg-gray-50">
        <td class="px-3 py-2 text-sm text-gray-600">${date}</td>
        <td class="px-3 py-2 text-sm font-mono">${kk}</td>
        <td class="px-3 py-2 text-sm text-center">${items}</td>
        <td class="px-3 py-2 text-sm font-bold text-right">${total}</td>
        <td class="px-3 py-2">
          <span class="inline-block px-2 py-0.5 text-[10px] font-bold uppercase ${badgeClass}">${status}</span>
        </td>
      </tr>
    `;
  }).join("");
}
