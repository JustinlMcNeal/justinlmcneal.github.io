/** Parse HTML-table text from Baestao .xls exports. */

const HTML_MARKERS = /<(?:html|table|meta|head|body|!DOCTYPE)/i;
const BINARY_OLE = /\xD0\xCF\x11\xE0/;
const ZIP_XLSX = /^PK\x03\x04/;

/**
 * @param {string} text
 */
export function isLikelyBinaryContent(text) {
  if (!text) return true;
  const head = text.slice(0, 512);
  if (ZIP_XLSX.test(head)) return true;
  if (BINARY_OLE.test(head)) return true;
  const nullCount = (head.match(/\0/g) || []).length;
  if (nullCount > 4) return true;
  return false;
}

/**
 * @param {string} text
 */
export function detectHtmlTableText(text) {
  if (!text || !text.trim()) return false;
  return HTML_MARKERS.test(text);
}

/**
 * @param {string} text
 * @returns {string[][][]}
 */
export function parseHtmlTables(text) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, "text/html");
  const tables = [...doc.querySelectorAll("table")];
  return tables.map(extractTableRows).filter((rows) => rows.length > 0);
}

/**
 * @param {HTMLTableElement} table
 * @returns {string[][]}
 */
function extractTableRows(table) {
  const rows = [];
  table.querySelectorAll("tr").forEach((tr) => {
    const cells = [];
    tr.querySelectorAll("th, td").forEach((cell) => {
      cells.push(normalizeCellText(cell.textContent));
    });
    if (cells.some((c) => c.length > 0)) rows.push(cells);
  });
  return rows;
}

/**
 * @param {string | null | undefined} raw
 */
export function normalizeCellText(raw) {
  if (raw == null) return "";
  return String(raw)
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Preserve table structure with raw cell text (no DOM).
 * @param {string[][]} rows
 */
export function cloneTableRows(rows) {
  return rows.map((row) => row.map((cell) => cell));
}
