import { money, esc } from "./dom.js";

export function renderTable({ els, state }) {
  const rows = state.view || [];
  els.countLabel.textContent = `${rows.length} item${rows.length === 1 ? "" : "s"}`;

  if (!rows.length) {
    els.storageRows.innerHTML = `
      <tr>
        <td colspan="6" style="padding:16px;">
          <div class="kk-sub" style="margin:0;">No stored items yet.</div>
        </td>
      </tr>
    `;
    return;
  }

  els.storageRows.innerHTML = rows.map((r) => {
    const url = (r.url || "").trim();
    const name = esc(r.name || "Untitled");
    const stage = esc(r.stage || "idea");
    const pid = esc(r.product_id || "");
    const tags = Array.isArray(r.tags) && r.tags.length ? esc(r.tags.join(", ")) : "";

    const metaBits = [];
    if (pid) metaBits.push(`ID: ${pid}`);
    if (tags) metaBits.push(`Tags: ${tags}`);

    const meta = metaBits.length ? `<div class="kk-ps-meta">${metaBits.join(" · ")}</div>` : "";

    const nameHtml = url
      ? `<a class="kk-ps-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${name}</a>${meta}`
      : `<div class="kk-ps-name">${name}</div>${meta}`;

    return `
      <tr data-id="${esc(r.id)}">
        <td>${nameHtml}</td>
        <td><span class="kk-ps-stage ${stage === "archived" ? "is-archived" : ""}">${stage}</span></td>
        <td>${money(r.target_price)}</td>
        <td>${money(r.unit_cost)}</td>
        <td>${esc(r.weight_g ?? "")}</td>
        <td class="kk-admin-table-actions">
          <button class="kk-btn kk-admin-mini-btn" type="button" data-action="edit" data-id="${esc(r.id)}">Edit</button>
        </td>
      </tr>
    `;
  }).join("");
}
