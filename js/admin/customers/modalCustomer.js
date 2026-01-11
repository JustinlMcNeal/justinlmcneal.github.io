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
  els.customerModal?.classList.add("is-open");
  els.customerModal?.setAttribute("aria-hidden", "false");
}

export function closeCustomerModal(els) {
  els.customerModal?.classList.remove("is-open");
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

  // If you don’t have modalMsg in HTML, this safely does nothing.
  if (els.modalMsg) els.modalMsg.textContent = msg || "";
  else {
    // fallback: show status in header email line if no modalMsg element exists
    if (msg) els.modalCustomerEmail.textContent = msg;
  }
}

export function renderOrderHistory(els, orders) {
  if (!els.customerOrdersRows) return;

  if (!orders?.length) {
    els.customerOrdersRows.innerHTML = `
      <tr><td colspan="5" style="padding:14px;">No orders found.</td></tr>
    `;
    return;
  }

  els.customerOrdersRows.innerHTML = orders.map(o => {
    const date = esc(fmtDate(o.order_date));
    const kk = esc(o.kk_order_id || "—");
    const items = Number(o.total_items || 0);
    const total = esc(moneyFromCents(o.total_paid_cents));
    const status = esc(o.label_status || "—");

    return `
      <tr>
        <td>${date}</td>
        <td>${kk}</td>
        <td>${items}</td>
        <td>${total}</td>
        <td>${status}</td>
      </tr>
    `;
  }).join("");
}
