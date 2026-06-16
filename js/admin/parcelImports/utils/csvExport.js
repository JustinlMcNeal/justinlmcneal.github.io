/** Client-side CSV build + download helpers (Phase 13). */

/**
 * @param {unknown} value
 */
export function escapeCsvCell(value) {
  if (value == null) return "";
  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/**
 * @param {string[]} headers
 * @param {Record<string, unknown>[]} rows
 * @param {string[]} keys
 */
export function buildCsv(headers, rows, keys) {
  const lines = [headers.map(escapeCsvCell).join(",")];
  rows.forEach((row) => {
    lines.push(keys.map((key) => escapeCsvCell(row[key])).join(","));
  });
  return lines.join("\r\n");
}

/**
 * @param {string} filename
 * @param {string} csvText
 */
export function downloadCsv(filename, csvText) {
  const blob = new Blob([csvText], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** @returns {string} */
export function csvDateStamp() {
  return new Date().toISOString().slice(0, 10);
}
