// /js/admin/lineItemsOrders/pirateShipImport.js

const OZ_TO_G = 28.349523125;

function stripBom(s) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function detectDelimiter(headerLine) {
  // Pirate Ship exports are often TSV, sometimes CSV.
  // We detect by which delimiter produces more columns.
  const commaCols = headerLine.split(",").length;
  const tabCols = headerLine.split("\t").length;
  return tabCols > commaCols ? "\t" : ",";
}

function parseCsvLine(line, delim) {
  // Minimal CSV parser supporting quoted values.
  const out = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === delim) {
        out.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

function toIsoOrNull(s) {
  const t = String(s || "").trim();
  if (!t) return null;

  // Pirate Ship often exports like: "12/26/2025" or "12/26/2025 3:30 PM"
  // Date.parse handles a lot of these in browsers; if it fails, we null it.
  const ms = Date.parse(t);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function toCentsOrNull(s) {
  const t = String(s || "").trim();
  if (!t) return null;
  const n = Number(t.replace(/[^0-9.\-]/g, ""));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

function toGramsFromOzOrNull(s) {
  const t = String(s || "").trim();
  if (!t) return null;
  const n = Number(t.replace(/[^0-9.\-]/g, ""));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * OZ_TO_G);
}

function makeBatchId() {
  const d = new Date();
  const pad = (x) => String(x).padStart(2, "0");
  const stamp =
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const rnd = Math.random().toString(16).slice(2, 6).toUpperCase();
  return `PS-${stamp}-${rnd}`;
}

/**
 * Parse Pirate Ship export file into rows for rpc_import_pirateship_export
 * Required column: "Order ID" -> kk_order_id
 */
export function parsePirateShipExportText(text) {
  const raw = stripBom(String(text || "")).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { rows: [], errors: ["File has no data rows."], delimiter: "," };

  const delim = detectDelimiter(lines[0]);
  const header = parseCsvLine(lines[0], delim);

  const idx = (name) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());

  const iOrderId = idx("Order ID");
  const iTracking = idx("Tracking Number");
  const iCarrier = idx("Carrier");
  const iService = idx("Service");
  const iCost = idx("Cost");
  const iShipDate = idx("Ship Date");
  const iLabelDate = idx("Label Created Date");
  const iWeightOz = idx("Weight (oz)");

  const errors = [];
  if (iOrderId < 0) errors.push(`Missing required column: "Order ID"`);

  const rows = [];
  for (let li = 1; li < lines.length; li++) {
    const cols = parseCsvLine(lines[li], delim);
    const kk_order_id = cols[iOrderId] ? String(cols[iOrderId]).trim() : "";

    if (!kk_order_id) continue;

    const tracking_number = iTracking >= 0 ? String(cols[iTracking] || "").trim() : "";
    const carrier = iCarrier >= 0 ? String(cols[iCarrier] || "").trim() : "";
    const service = iService >= 0 ? String(cols[iService] || "").trim() : "";
    const label_cost_cents = iCost >= 0 ? toCentsOrNull(cols[iCost]) : null;

    const shipped_at = iShipDate >= 0 ? toIsoOrNull(cols[iShipDate]) : null;
    const label_purchased_at = iLabelDate >= 0 ? toIsoOrNull(cols[iLabelDate]) : null;

    const package_weight_g_final = iWeightOz >= 0 ? toGramsFromOzOrNull(cols[iWeightOz]) : null;

    rows.push({
      kk_order_id,
      tracking_number: tracking_number || null,
      carrier: carrier || null,
      service: service || null,
      label_cost_cents,
      label_purchased_at,
      shipped_at,
      package_weight_g_final,
    });
  }

  return { rows, errors, delimiter: delim };
}

/**
 * Wire a button to open file picker, parse, and call importer
 */
/**
 * Wire a button to:
 * - click -> file picker
 * - drag/drop -> import
 */
export function wirePirateShipImport({
  buttonEl,
  setStatus,
  onImported,
  importFn, // async ({ batchId, rows }) => { updated_count, skipped_count }
} = {}) {
  if (!buttonEl) return;

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = ".csv,.tsv,text/csv,text/tab-separated-values,application/vnd.ms-excel";
  fileInput.style.display = "none";
  document.body.appendChild(fileInput);

  // enable the button (even if HTML had disabled)
  buttonEl.disabled = false;

  // --- helpers ---
  const isValidFile = (file) => {
    if (!file) return false;
    const name = (file.name || "").toLowerCase();
    return name.endsWith(".csv") || name.endsWith(".tsv") || (file.type || "").includes("csv");
  };

  async function handleFile(file) {
    if (!file) return;
    if (!isValidFile(file)) {
      setStatus?.("Import failed: please drop a .csv or .tsv export from Pirate Ship.", true);
      return;
    }

    try {
      setStatus?.(`Reading ${file.name}…`);
      const text = await file.text();

      const { rows, errors } = parsePirateShipExportText(text);
      if (errors?.length) throw new Error(errors.join(" | "));
      if (!rows.length) throw new Error("No importable rows found in file.");

      const batchId = makeBatchId();

      const ok = window.confirm(
        `Import Pirate Ship export?\n\n` +
          `Rows detected: ${rows.length}\n` +
          `Batch ID: ${batchId}\n\n` +
          `This will update fulfillment_shipments (status, tracking, label cost, printed_at).`
      );
      if (!ok) {
        setStatus?.("Import canceled.");
        return;
      }

      setStatus?.(`Importing ${rows.length} rows…`);
      const result = await importFn?.({ batchId, rows });

      const updated = Number(result?.updated_count ?? 0);
      const skipped = Number(result?.skipped_count ?? 0);

      setStatus?.(`Imported. Updated: ${updated}. Skipped (no match): ${skipped}.`);
      onImported?.({ updated, skipped, batchId });
    } catch (e) {
      console.error(e);
      setStatus?.(`Import failed: ${e?.message || e}`, true);
    }
  }

  // --- click to pick ---
  buttonEl.addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    await handleFile(file);
  });

  // --- drag/drop UX on the button ---
  const DROP_CLASS = "is-drop-active";

  function setDropActive(on) {
    buttonEl.classList.toggle(DROP_CLASS, !!on);
  }

  // Prevent browser from opening the file if dropped outside
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => e.preventDefault());

  buttonEl.addEventListener("dragenter", (e) => {
    e.preventDefault();
    setDropActive(true);
  });

  buttonEl.addEventListener("dragover", (e) => {
    e.preventDefault();
    setDropActive(true);
  });

  buttonEl.addEventListener("dragleave", (e) => {
    e.preventDefault();
    // only turn off if leaving the button area
    if (e.relatedTarget && buttonEl.contains(e.relatedTarget)) return;
    setDropActive(false);
  });

  buttonEl.addEventListener("drop", async (e) => {
    e.preventDefault();
    setDropActive(false);

    const file = e.dataTransfer?.files?.[0];
    await handleFile(file);
  });
}

