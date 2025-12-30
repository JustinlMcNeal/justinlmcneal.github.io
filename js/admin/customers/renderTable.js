// /js/admin/customers/renderTable.js
function moneyFromCents(cents) {
  const n = Number(cents || 0) / 100;
  return `$${n.toFixed(2)}`;
}

function fmtDate(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString();
  } catch {
    return String(d);
  }
}

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function fullName(r) {
  const a = (r.first_name || "").trim();
  const b = (r.last_name || "").trim();
  const x = `${a} ${b}`.trim();
  return x.length ? x : "—";
}

function fmtAddress(r) {
  const parts = [
    r.street_address,
    [r.city, r.state, r.zip].filter(Boolean).join(", ").replace(", ,", ", "),
    r.country
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "—";
}

function fmtShip(r) {
  const s = (r.last_label_status || "").trim();
  return s || "—";
}

export function renderCustomersTable(tbodyEl, rows) {
  if (!tbodyEl) return;

  if (!rows?.length) {
    tbodyEl.innerHTML = `
      <tr>
        <td colspan="7" style="padding:16px;">No customers found.</td>
      </tr>
    `;
    return;
  }

  tbodyEl.innerHTML = rows.map(r => {
    const email = esc(r.email || "");
    const name = esc(fullName(r));
    const addr = esc(fmtAddress(r));
    const orders = Number(r.order_count || 0);
    const spent = moneyFromCents(r.total_spent_cents);
    const last = fmtDate(r.last_order_at);
    const ship = esc(fmtShip(r));

    return `
      <tr data-email="${email}">
        <td>
          <div class="kk-admin-customer-name">${name}</div>
          <div class="kk-sub">Last status: <b>${ship}</b></div>
        </td>
        <td>${email || "—"}</td>
        <td class="kk-admin-customer-address">${addr}</td>
        <td>${orders}</td>
        <td>${spent}</td>
        <td>${esc(last)}</td>
        <td>
          <button class="kk-admin-btn kk-admin-btn-ghost" type="button" data-action="open">
            View
          </button>
        </td>
      </tr>
    `;
  }).join("");
}

export function wireCustomerRowClicks(tbodyEl, onOpen) {
  if (!tbodyEl) return;

  tbodyEl.onclick = (e) => {
    const btn = e.target?.closest?.("[data-action='open']");
    const tr = e.target?.closest?.("tr[data-email]");
    if (!tr) return;
    const email = tr.getAttribute("data-email") || "";
    if (btn || tr) onOpen?.(email);
  };
}
