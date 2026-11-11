/** Parcel Planner tab — queue items for the next Baestao parcel and order when shipping is efficient. */

import {
  deletePlanItem,
  fetchLastPurchase,
  fetchPlanItems,
  fetchRestockSuggestions,
  fetchShippingHistory,
  insertPlanItem,
  markPlanItemsOrdered,
  searchProductsForPlan,
  updatePlanItem,
} from "../api/parcelPlannerApi.js";
import { buildCsv, csvDateStamp, downloadCsv } from "../utils/csvExport.js";
import {
  DEFAULT_PLAN_SETTINGS,
  estimatePlan,
  fitShippingModel,
  resolveModel,
  shippingLadder,
} from "../utils/parcelPlanMath.js";

const SETTINGS_KEY = "kk.parcelPlanner.settings.v1";
const EDITABLE_FIELDS = ["qty", "unit_price_cny", "unit_weight_g", "seller_freight_cny", "target_price_usd"];

const CARD = "bg-white rounded-2xl shadow-sm border border-gray-200";
const BTN_PRIMARY =
  "inline-flex items-center justify-center border-4 border-black bg-black text-white px-4 py-2.5 font-black uppercase tracking-[.12em] text-[10px] sm:text-xs min-h-[44px] hover:bg-gray-900 disabled:opacity-50 disabled:cursor-not-allowed";
const BTN_SECONDARY =
  "inline-flex items-center justify-center border-2 border-black bg-white text-black px-3 py-2 text-[10px] font-black uppercase tracking-[.12em] min-h-[40px] hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed";
const INPUT = "border-2 border-gray-300 rounded-lg px-2 py-1.5 text-xs w-full";
const MISSING_CLASS = "!border-red-500";
const LABEL = "block text-[9px] font-black uppercase tracking-[.14em] text-gray-500 mb-1";

const READINESS_STYLES = {
  empty: { pill: "bg-gray-100 text-gray-700 border-gray-400", bar: "bg-gray-400" },
  early: { pill: "bg-red-50 text-red-800 border-red-600", bar: "bg-red-500" },
  close: { pill: "bg-amber-50 text-amber-800 border-amber-500", bar: "bg-amber-400" },
  ready: { pill: "bg-green-50 text-green-800 border-green-600", bar: "bg-green-500" },
};

/** @type {object[]} */
let items = [];
/** @type {object[]} */
let suggestions = [];
/** @type {ReturnType<typeof fitShippingModel> | null} */
let fittedModel = null;
let settings = loadSettings();
/** @type {object | null} */
let pendingProduct = null;
let searchTimer = 0;

/** @param {{ authed: boolean }} opts */
export async function initParcelPlanner({ authed }) {
  const root = document.getElementById("parcelPlannerRoot");
  if (!root) return;
  root.innerHTML = skeletonHtml();
  wireEvents(root);

  if (!authed) {
    setStatus("Log in as admin to use the parcel planner.", "error");
    return;
  }
  await reloadAll();
}

async function reloadAll() {
  setStatus("Loading plan…");
  try {
    const [planRows, history, restock] = await Promise.all([
      fetchPlanItems(),
      fetchShippingHistory(),
      fetchRestockSuggestions().catch((err) => {
        console.warn("[parcelPlanner] restock suggestions", err);
        return [];
      }),
    ]);
    items = planRows;
    fittedModel = fitShippingModel(history);
    suggestions = restock;
    renderAll();
    setStatus("");
  } catch (err) {
    console.error("[parcelPlanner] load", err);
    setStatus(err.message || "Failed to load plan.", "error");
  }
}

// ─── Rendering ──────────────────────────────────────────────────────────────

function currentModel() {
  return resolveModel(fittedModel || fitShippingModel([]), settings);
}

function renderAll() {
  renderSettings();
  renderTable();
  renderSuggestions();
  renderComputed();
}

function renderComputed() {
  const m = currentModel();
  const est = estimatePlan(items, m, settings);
  renderSummary(est, m);
  renderLadder(m, est);
  est.rows.forEach((row) => {
    setCalc(row.id, "ship", usd(row.shipPerUnitUsd));
    setCalc(row.id, "landed", usd(row.landedUsd));
    setCalc(row.id, "profit", row.profitUsd == null ? "—" : usd(row.profitUsd), marginClass(row.marginPct));
    setCalc(row.id, "margin", row.marginPct == null ? "—" : `${Math.round(row.marginPct)}%`, marginClass(row.marginPct));
  });
}

function renderSummary(est, m) {
  const el = document.getElementById("parcelPlannerSummary");
  if (!el) return;
  const style = READINESS_STYLES[est.readiness.level];
  const targetPct = Number(settings.targetSharePct) || 0;
  const sharePct = Math.round(est.shippingShare * 100);

  const insight =
    est.avgShipPer100gUsd != null
      ? `Right now shipping averages <strong>${usd(est.avgShipPer100gUsd)}</strong> per 100 g of product. Each extra 100 g only adds about <strong>${usd(est.marginalShipPer100gUsd)}</strong> — the fixed parcel fee (~${usd(m.fixedCny / m.fxRate)}) is what makes small parcels expensive.`
      : `Every parcel carries a fixed fee of about <strong>${usd(m.fixedCny / m.fxRate)}</strong> before weight. Fill the parcel so that fee is spread over more items.`;

  el.innerHTML = `
    <div class="flex flex-col lg:flex-row lg:items-center gap-4">
      <div class="lg:w-72 shrink-0">
        <span class="inline-flex items-center px-3 py-1.5 rounded-full border-2 text-[11px] font-black uppercase tracking-[.12em] ${style.pill}">${escapeHtml(est.readiness.label)}</span>
        <div class="mt-3">
          <div class="flex justify-between text-[10px] font-bold uppercase tracking-[.1em] text-gray-500">
            <span>Shipping share of parcel</span><span>${sharePct}% / target ≤ ${targetPct}%</span>
          </div>
          <div class="relative mt-1 h-3 rounded-full bg-gray-100 border border-gray-300 overflow-hidden">
            <div class="h-full ${style.bar}" style="width:${Math.min(sharePct, 100)}%"></div>
            <div class="absolute top-0 bottom-0 w-0.5 bg-black" style="left:${Math.min(targetPct, 100)}%" title="Target"></div>
          </div>
        </div>
      </div>
      <dl class="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2 flex-1">
        ${kpi("Items / units", `${items.length} / ${est.units}`)}
        ${kpi("Est. weight", `${(est.rawG / 1000).toFixed(2)} kg`, `charged ≈ ${est.chargedKg.toFixed(2)} kg`)}
        ${kpi("Products", `¥${est.itemsCny.toFixed(2)}`, usd(est.itemsCny / m.fxRate))}
        ${kpi("Shipping est.", `¥${est.shipCny.toFixed(0)}`, usd(est.shipUsd))}
        ${kpi("Total", usd(est.totalUsd), `¥${est.totalCny.toFixed(0)}`)}
        ${kpi("Shipping / unit", est.units ? usd(est.shipUsd / est.units) : "—", "avg across units")}
      </dl>
    </div>
    <p class="mt-3 text-xs text-gray-600 leading-relaxed">${insight}${pastSharesNote()}</p>`;
}

function pastSharesNote() {
  const shares = fittedModel?.pastShares || [];
  if (!shares.length) return "";
  const lo = Math.round(Math.min(...shares) * 100);
  const hi = Math.round(Math.max(...shares) * 100);
  return ` Your past ${shares.length} parcels ran <strong>${lo}–${hi}%</strong> shipping.`;
}

function renderLadder(m, est) {
  const el = document.getElementById("parcelPlannerLadder");
  if (!el) return;
  const rows = shippingLadder(m)
    .map((r) => {
      const current = est.chargedKg > 0 && Math.abs(est.chargedKg - r.kg) < 0.5;
      return `<tr class="${current ? "bg-pink-50 font-bold" : ""}">
        <td class="px-2 py-1">${r.kg} kg</td>
        <td class="px-2 py-1 text-right">¥${r.cny.toFixed(0)}</td>
        <td class="px-2 py-1 text-right">${usd(r.usd)}</td>
        <td class="px-2 py-1 text-right">${usd(r.usdPerKg)}</td>
      </tr>`;
    })
    .join("");
  el.innerHTML = `
    <table class="w-full text-xs">
      <thead><tr class="text-[9px] font-black uppercase tracking-[.1em] text-gray-500 text-left">
        <th class="px-2 py-1">Charged</th><th class="px-2 py-1 text-right">Shipping ¥</th><th class="px-2 py-1 text-right">USD</th><th class="px-2 py-1 text-right">$/kg</th>
      </tr></thead>
      <tbody class="divide-y divide-gray-100">${rows}</tbody>
    </table>
    <p class="mt-2 text-[10px] text-gray-400">Model: ¥${m.fixedCny.toFixed(0)} fixed + ¥${m.perKgCny.toFixed(1)}/kg, charged weight ≈ ${m.volumeFactor.toFixed(2)}× actual${fittedModel?.samples ? ` (fit from ${fittedModel.samples} past parcels)` : " (default — no parcel history)"}.</p>`;
}

function renderTable() {
  const tbody = document.getElementById("parcelPlannerTbody");
  if (!tbody) return;
  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="10" class="px-3 py-8 text-center text-sm text-gray-400">No items planned yet. Add one below or pull from restock suggestions.</td></tr>`;
    return;
  }
  tbody.innerHTML = items.map(rowHtml).join("");
}

function rowHtml(it) {
  const code = it.products?.code;
  const img = it.products?.catalog_image_url || it.products?.primary_image_url;
  const link = it.supplier_url
    ? `<a href="${escapeAttr(it.supplier_url)}" target="_blank" rel="noopener" class="text-[10px] font-bold underline text-gray-500 hover:text-black">supplier ↗</a>`
    : "";
  const field = (name, step, width = "w-20") =>
    `<input type="number" min="0" step="${step}" data-plan-id="${it.id}" data-plan-field="${name}" value="${it[name] ?? ""}" class="${INPUT} ${width} text-right ${missingValueClass(name, it[name])}" />`;
  return `<tr data-plan-row="${it.id}" class="align-top">
    <td class="px-3 py-2">
      <div class="flex items-start gap-2">
        ${img ? `<img src="${escapeAttr(img)}" alt="" class="w-10 h-10 rounded-lg object-cover border border-gray-200 shrink-0" loading="lazy" />` : ""}
        <div class="min-w-0">
          <p class="font-bold text-xs leading-snug">${escapeHtml(it.title)}</p>
          <p class="text-[10px] text-gray-500">${[code, it.variant_label].filter(Boolean).map(escapeHtml).join(" · ")} ${link}</p>
        </div>
      </div>
    </td>
    <td class="px-2 py-2">${field("qty", "1", "w-16")}</td>
    <td class="px-2 py-2">${field("unit_price_cny", "0.01")}</td>
    <td class="px-2 py-2">${field("unit_weight_g", "1")}</td>
    <td class="px-2 py-2">${field("target_price_usd", "0.01")}</td>
    <td class="px-2 py-2 text-right text-xs font-mono" data-plan-calc="ship" data-plan-id="${it.id}">—</td>
    <td class="px-2 py-2 text-right text-xs font-mono font-bold" data-plan-calc="landed" data-plan-id="${it.id}">—</td>
    <td class="px-2 py-2 text-right text-xs font-mono font-bold" data-plan-calc="profit" data-plan-id="${it.id}">—</td>
    <td class="px-2 py-2 text-right text-xs font-mono" data-plan-calc="margin" data-plan-id="${it.id}">—</td>
    <td class="px-2 py-2 text-center">
      <button type="button" data-plan-action="remove" data-plan-id="${it.id}" title="Remove from plan" class="border border-gray-300 rounded-lg px-2 py-1 text-[10px] font-bold uppercase hover:bg-red-50 hover:border-red-500">Remove</button>
    </td>
  </tr>`;
}

function renderSuggestions() {
  const el = document.getElementById("parcelPlannerSuggestions");
  if (!el) return;
  const plannedProducts = new Set(items.map((it) => it.product_id).filter(Boolean));
  const open = suggestions.filter((s) => !plannedProducts.has(s.product_id));
  if (!open.length) {
    el.innerHTML = `<p class="text-xs text-gray-400">Nothing urgent — every product that sold in the last 90 days has 60+ days of stock (or is already in the plan).</p>`;
    return;
  }
  el.innerHTML = `<ul class="divide-y divide-gray-100">${open
    .map(
      (s) => `<li class="py-2 flex items-center gap-3">
        ${s.image_url ? `<img src="${escapeAttr(s.image_url)}" alt="" class="w-10 h-10 rounded-lg object-cover border border-gray-200 shrink-0" loading="lazy" />` : ""}
        <div class="min-w-0 flex-1">
          <p class="text-xs font-bold leading-snug">${escapeHtml(s.code)} — ${escapeHtml(s.name)}</p>
          <p class="text-[10px] text-gray-500">Stock ${s.stock} · sold ${s.sold_in_window} in 90 days · ${s.days_of_cover ?? 0} days left${s.last_unit_price_cny != null ? ` · last paid ¥${Number(s.last_unit_price_cny).toFixed(2)}` : ""}</p>
        </div>
        <button type="button" data-plan-action="add-suggestion" data-product-id="${s.product_id}" class="${BTN_SECONDARY} shrink-0">Add ${s.suggested_qty}</button>
      </li>`,
    )
    .join("")}</ul>`;
}

function renderSettings() {
  const el = document.getElementById("parcelPlannerSettings");
  if (!el) return;
  const fitted = fittedModel || fitShippingModel([]);
  const field = (key, label, step, placeholder) => `
    <label class="block">
      <span class="${LABEL}">${label}</span>
      <input type="number" step="${step}" data-plan-setting="${key}" value="${settings[key] ?? ""}" placeholder="${placeholder}" class="${INPUT}" />
    </label>`;
  el.innerHTML = `
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
      ${field("fxRate", "CNY per USD", "0.01", `auto ${(fitted.fxRate ?? 7.21).toFixed(2)}`)}
      ${field("fixedCny", "Fixed parcel fee ¥", "1", `auto ${fitted.fixedCny.toFixed(0)}`)}
      ${field("perKgCny", "Shipping ¥ per kg", "0.1", `auto ${fitted.perKgCny.toFixed(1)}`)}
      ${field("volumeFactor", "Charged ÷ actual weight", "0.01", `auto ${fitted.volumeFactor.toFixed(2)}`)}
      ${field("targetSharePct", "Ready when shipping ≤ %", "1", "45")}
      ${field("fvfPct", "eBay fee %", "0.01", "13.25")}
      ${field("fixedFeeUsd", "eBay per-order fee $", "0.01", "0.40")}
      ${field("adPct", "Promoted ad %", "0.1", "8")}
    </div>
    <div class="mt-3 flex items-center gap-3">
      <button type="button" data-plan-action="reset-settings" class="${BTN_SECONDARY}">Reset to defaults</button>
      <p class="text-[10px] text-gray-400">Blank shipping fields use the fit from your past parcels. Profit also subtracts the outbound USPS label for the item weight.</p>
    </div>`;
}

// ─── Events ─────────────────────────────────────────────────────────────────

function wireEvents(root) {
  root.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-plan-action]");
    if (!btn) return;
    const action = btn.dataset.planAction;
    if (action === "remove") void removeItem(btn.dataset.planId);
    else if (action === "add-suggestion") void addSuggestion(btn.dataset.productId, btn);
    else if (action === "copy-cart") void copyCartList();
    else if (action === "export-csv") exportCsv();
    else if (action === "mark-ordered") void markOrdered();
    else if (action === "reset-settings") {
      settings = { ...DEFAULT_PLAN_SETTINGS };
      saveSettings();
      renderSettings();
      renderComputed();
    } else if (action === "pick-product") void pickProduct(btn.dataset.productIndex);
    else if (action === "clear-product") clearPendingProduct();
  });

  root.addEventListener("change", (e) => {
    const input = e.target;
    if (input.dataset?.planField) void saveField(input);
    else if (input.dataset?.planSetting) {
      const value = input.value.trim();
      settings[input.dataset.planSetting] = value === "" ? DEFAULT_PLAN_SETTINGS[input.dataset.planSetting] : Number(value);
      saveSettings();
      renderComputed();
    }
  });

  root.addEventListener("input", (e) => {
    if (e.target.id !== "planProductSearch") return;
    clearTimeout(searchTimer);
    const query = e.target.value;
    searchTimer = window.setTimeout(() => void runProductSearch(query), 250);
  });

  root.querySelector("#parcelPlannerAddForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    void addFromForm(e.currentTarget);
  });
}

async function saveField(input) {
  const id = input.dataset.planId;
  const field = input.dataset.planField;
  if (!EDITABLE_FIELDS.includes(field)) return;
  const item = items.find((it) => it.id === id);
  if (!item) return;

  const raw = input.value.trim();
  let value = raw === "" ? null : Number(raw);
  if (field === "qty") value = Math.max(1, Math.round(value || 1));
  else if (field !== "target_price_usd") value = Math.max(0, value || 0);
  input.value = value ?? "";
  input.classList.remove(MISSING_CLASS);
  if (missingValueClass(field, value)) input.classList.add(MISSING_CLASS);

  item[field] = value;
  renderComputed();
  try {
    await updatePlanItem(id, { [field]: value });
  } catch (err) {
    setStatus(err.message, "error");
  }
}

async function removeItem(id) {
  try {
    await deletePlanItem(id);
    items = items.filter((it) => it.id !== id);
    renderTable();
    renderSuggestions();
    renderComputed();
  } catch (err) {
    setStatus(err.message, "error");
  }
}

async function addSuggestion(productId, btn) {
  const s = suggestions.find((row) => row.product_id === productId);
  if (!s) return;
  btn.disabled = true;
  await addItem({
    title: s.name,
    product_id: s.product_id,
    supplier_url: s.supplier_url,
    unit_price_cny: Number(s.last_unit_price_cny) || 0,
    qty: s.suggested_qty,
    unit_weight_g: Number(s.unit_weight_g) || 0,
    target_price_usd: s.sell_price_usd != null ? Math.round(Number(s.sell_price_usd) * 100) / 100 : null,
    notes: "Restock suggestion",
  });
}

async function addFromForm(form) {
  const fd = new FormData(form);
  const title = String(fd.get("title") || "").trim();
  if (!title) {
    setStatus("Give the item a name first.", "error");
    return;
  }
  const n = (key) => {
    const v = String(fd.get(key) || "").trim();
    return v === "" ? null : Number(v);
  };
  const ok = await addItem({
    title,
    product_id: pendingProduct?.id ?? null,
    variant_label: String(fd.get("variant_label") || "").trim() || null,
    supplier_url: String(fd.get("supplier_url") || "").trim() || null,
    unit_price_cny: n("unit_price_cny") ?? 0,
    qty: Math.max(1, Math.round(n("qty") ?? 1)),
    unit_weight_g: n("unit_weight_g") ?? 0,
    seller_freight_cny: n("seller_freight_cny") ?? 0,
    target_price_usd: n("target_price_usd"),
  });
  if (ok) {
    form.reset();
    clearPendingProduct();
  }
}

async function addItem(row) {
  try {
    const saved = await insertPlanItem(row);
    items.push(saved);
    renderTable();
    renderSuggestions();
    renderComputed();
    setStatus(`Added ${saved.title}.`);
    return true;
  } catch (err) {
    setStatus(err.message, "error");
    return false;
  }
}

/** @type {object[]} */
let searchResults = [];

async function runProductSearch(query) {
  const list = document.getElementById("planProductResults");
  if (!list) return;
  if (!query.trim()) {
    list.innerHTML = "";
    return;
  }
  try {
    searchResults = await searchProductsForPlan(query);
    list.innerHTML = searchResults.length
      ? searchResults
          .map(
            (p, i) =>
              `<button type="button" data-plan-action="pick-product" data-product-index="${i}" class="block w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50"><span class="font-mono font-bold">${escapeHtml(p.code)}</span> ${escapeHtml(p.name)}</button>`,
          )
          .join("")
      : `<p class="px-3 py-1.5 text-xs text-gray-400">No matching products — just type a name below for new items.</p>`;
  } catch (err) {
    list.innerHTML = `<p class="px-3 py-1.5 text-xs text-red-600">${escapeHtml(err.message)}</p>`;
  }
}

async function pickProduct(index) {
  const p = searchResults[Number(index)];
  const form = document.getElementById("parcelPlannerAddForm");
  if (!p || !form) return;
  pendingProduct = p;
  form.elements.title.value = p.name;
  if (p.supplier_url) form.elements.supplier_url.value = p.supplier_url;
  const sell = p.ebay_price_cents != null ? p.ebay_price_cents / 100 : p.price;
  if (sell != null) form.elements.target_price_usd.value = Number(sell).toFixed(2);
  if (p.weight_g) form.elements.unit_weight_g.value = p.weight_g;
  document.getElementById("planProductResults").innerHTML = "";
  document.getElementById("planProductSearch").value = "";
  document.getElementById("planLinkedProduct").innerHTML = `Linked to <strong>${escapeHtml(p.code)}</strong> <button type="button" data-plan-action="clear-product" class="underline ml-1">unlink</button>`;

  try {
    const last = await fetchLastPurchase(p.id);
    if (last) {
      form.elements.unit_price_cny.value = last.unitPriceCny.toFixed(2);
      if (last.unitWeightG) form.elements.unit_weight_g.value = last.unitWeightG;
    }
  } catch (err) {
    console.warn("[parcelPlanner] last purchase", err);
  }
}

function clearPendingProduct() {
  pendingProduct = null;
  const el = document.getElementById("planLinkedProduct");
  if (el) el.innerHTML = "";
}

async function copyCartList() {
  if (!items.length) {
    setStatus("Nothing to copy yet.", "error");
    return;
  }
  const text = items
    .map((it) => {
      const name = [it.products?.code, it.title, it.variant_label].filter(Boolean).join(" — ");
      return `${it.qty} × ${name}${it.supplier_url ? `\n    ${it.supplier_url}` : ""}`;
    })
    .join("\n");
  try {
    await navigator.clipboard.writeText(text);
    setStatus("Cart list copied — paste it next to Baestao while you add items.");
  } catch {
    setStatus("Clipboard blocked by the browser. Use Export CSV instead.", "error");
  }
}

function exportCsv() {
  const m = currentModel();
  const est = estimatePlan(items, m, settings);
  const byId = new Map(est.rows.map((r) => [r.id, r]));
  const rows = items.map((it) => {
    const r = byId.get(it.id);
    return {
      code: it.products?.code ?? "",
      title: it.title,
      variant: it.variant_label ?? "",
      qty: it.qty,
      unit_price_cny: it.unit_price_cny,
      unit_weight_g: it.unit_weight_g,
      supplier_url: it.supplier_url ?? "",
      sell_usd: it.target_price_usd ?? "",
      landed_usd: r ? r.landedUsd.toFixed(2) : "",
      profit_usd: r?.profitUsd != null ? r.profitUsd.toFixed(2) : "",
    };
  });
  const keys = ["code", "title", "variant", "qty", "unit_price_cny", "unit_weight_g", "supplier_url", "sell_usd", "landed_usd", "profit_usd"];
  downloadCsv(`parcel-plan-${csvDateStamp()}.csv`, buildCsv(keys, rows, keys));
}

async function markOrdered() {
  if (!items.length) return;
  if (!window.confirm(`Mark all ${items.length} planned items as ordered? They will leave the plan.`)) return;
  try {
    await markPlanItemsOrdered(items.map((it) => it.id));
    items = [];
    renderTable();
    renderSuggestions();
    renderComputed();
    setStatus("Marked as ordered. Import the parcel export here once it ships.");
  } catch (err) {
    setStatus(err.message, "error");
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    return { ...DEFAULT_PLAN_SETTINGS, ...saved };
  } catch {
    return { ...DEFAULT_PLAN_SETTINGS };
  }
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function setCalc(id, key, text, className = "") {
  const el = document.querySelector(`[data-plan-calc="${key}"][data-plan-id="${id}"]`);
  if (!el) return;
  el.textContent = text;
  el.classList.remove("text-red-600", "text-amber-600", "text-green-700");
  if (className) el.classList.add(className);
}

function missingValueClass(field, value) {
  const required = field === "unit_price_cny" || field === "unit_weight_g" || field === "target_price_usd";
  return required && !(Number(value) > 0) ? MISSING_CLASS : "";
}

function marginClass(marginPct) {
  if (marginPct == null) return "";
  if (marginPct < 15) return "text-red-600";
  if (marginPct < 30) return "text-amber-600";
  return "text-green-700";
}

function setStatus(message, tone = "info") {
  const el = document.getElementById("parcelPlannerStatus");
  if (!el) return;
  el.textContent = message;
  el.className = `text-xs min-h-[1rem] ${tone === "error" ? "text-red-600 font-bold" : "text-gray-500"}`;
}

function kpi(label, value, sub = "") {
  return `<div class="rounded-xl border-2 border-gray-200 px-3 py-2">
    <dt class="text-[9px] font-black uppercase tracking-[.12em] text-gray-500">${label}</dt>
    <dd class="text-sm font-black mt-0.5">${value}</dd>
    ${sub ? `<dd class="text-[10px] text-gray-400">${sub}</dd>` : ""}
  </div>`;
}

function usd(n) {
  return `$${(Number(n) || 0).toFixed(2)}`;
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/'/g, "&#39;");
}

function skeletonHtml() {
  const formField = (name, label, attrs = "") => `
    <label class="block">
      <span class="${LABEL}">${label}</span>
      <input name="${name}" ${attrs} class="${INPUT}" />
    </label>`;
  return `
  <div class="space-y-4 sm:space-y-6">
    <article class="${CARD} p-4 sm:p-6">
      <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h2 class="text-lg sm:text-xl font-black tracking-tight">Plan next parcel</h2>
          <p class="text-xs sm:text-sm text-gray-500 mt-1 max-w-2xl">
            Queue what you want from 1688/Taobao. The planner estimates shipping from your past parcels and tells you when the parcel is full enough that shipping stops eating the profit.
          </p>
        </div>
        <div class="flex flex-wrap gap-2 shrink-0">
          <button type="button" data-plan-action="copy-cart" class="${BTN_SECONDARY}">Copy cart list</button>
          <button type="button" data-plan-action="export-csv" class="${BTN_SECONDARY}">Export CSV</button>
          <button type="button" data-plan-action="mark-ordered" class="${BTN_PRIMARY}">Mark ordered</button>
        </div>
      </div>
      <p id="parcelPlannerStatus" class="text-xs min-h-[1rem] text-gray-500 mt-2"></p>
      <div id="parcelPlannerSummary" class="mt-3"></div>
    </article>

    <article class="${CARD} overflow-hidden">
      <div class="overflow-x-auto overscroll-x-contain">
        <table class="w-full border-collapse text-sm min-w-[980px]">
          <thead class="bg-gray-50 border-b border-gray-200">
            <tr class="text-left text-[10px] font-black uppercase tracking-[.1em] text-gray-600">
              <th scope="col" class="px-3 py-2.5">Item</th>
              <th scope="col" class="px-2 py-2.5">Qty</th>
              <th scope="col" class="px-2 py-2.5">¥ / unit</th>
              <th scope="col" class="px-2 py-2.5">g / unit</th>
              <th scope="col" class="px-2 py-2.5">Sell $</th>
              <th scope="col" class="px-2 py-2.5 text-right">Ship / unit</th>
              <th scope="col" class="px-2 py-2.5 text-right">Landed</th>
              <th scope="col" class="px-2 py-2.5 text-right">eBay profit</th>
              <th scope="col" class="px-2 py-2.5 text-right">Margin</th>
              <th scope="col" class="px-2 py-2.5"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody id="parcelPlannerTbody" class="divide-y divide-gray-100"></tbody>
        </table>
      </div>
      <form id="parcelPlannerAddForm" class="border-t-4 border-black bg-gray-50 px-4 sm:px-6 py-4 space-y-3">
        <p class="text-[10px] font-black uppercase tracking-[.14em]">Add item</p>
        <div class="relative max-w-md">
          <label class="block">
            <span class="${LABEL}">Existing product (optional — fills price, weight, link)</span>
            <input id="planProductSearch" type="search" autocomplete="off" placeholder="Search KK code or name" class="${INPUT}" />
          </label>
          <div id="planProductResults" class="absolute z-10 left-0 right-0 bg-white border-2 border-black rounded-lg mt-1 max-h-60 overflow-y-auto empty:hidden"></div>
          <p id="planLinkedProduct" class="text-[10px] text-gray-600 mt-1"></p>
        </div>
        <div class="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
          <div class="col-span-2">${formField("title", "Name", 'required placeholder="e.g. Frog bucket hat"')}</div>
          ${formField("variant_label", "Variant", 'placeholder="Color / size"')}
          <div class="col-span-2">${formField("supplier_url", "Supplier link", 'type="url" placeholder="https://detail.1688.com/…"')}</div>
          ${formField("unit_price_cny", "¥ / unit", 'type="number" min="0" step="0.01"')}
          ${formField("qty", "Qty", 'type="number" min="1" step="1" value="1"')}
          ${formField("unit_weight_g", "g / unit", 'type="number" min="0" step="1"')}
          ${formField("seller_freight_cny", "Seller freight ¥", 'type="number" min="0" step="0.01"')}
          ${formField("target_price_usd", "Sell price $", 'type="number" min="0" step="0.01"')}
        </div>
        <button type="submit" class="${BTN_PRIMARY}">Add to plan</button>
      </form>
    </article>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
      <article class="${CARD} p-4 sm:p-6">
        <h3 class="text-base font-black tracking-tight">Restock suggestions</h3>
        <p class="text-xs text-gray-500 mt-1">Products that sold in the last 90 days with under 60 days of stock left.</p>
        <div id="parcelPlannerSuggestions" class="mt-3"></div>
      </article>
      <article class="${CARD} p-4 sm:p-6">
        <h3 class="text-base font-black tracking-tight">Shipping cost by parcel size</h3>
        <p class="text-xs text-gray-500 mt-1">Bigger parcels spread the fixed fee — compare $/kg.</p>
        <div id="parcelPlannerLadder" class="mt-3"></div>
      </article>
    </div>

    <details class="${CARD} p-4 sm:p-6">
      <summary class="cursor-pointer text-sm font-black uppercase tracking-[.12em]">Assumptions</summary>
      <div id="parcelPlannerSettings" class="mt-4"></div>
    </details>
  </div>`;
}
