/** Upload card status UI (Phase 1B). */

import { MAX_UPLOAD_ISSUES_SHOWN, UPLOAD_STATUS } from "../constants.js";
import { getDom } from "../dom.js";
import { getState } from "../state.js";

const STATUS_CLASS = {
  [UPLOAD_STATUS.IDLE]:
    "rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600",
  [UPLOAD_STATUS.PARSING]:
    "rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900 font-medium",
  [UPLOAD_STATUS.SUCCESS]:
    "rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-900 font-medium",
  [UPLOAD_STATUS.WARNING]:
    "rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950",
  [UPLOAD_STATUS.ERROR]:
    "rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900 font-medium",
};

/**
 * @param {string} status
 * @param {string} message
 * @param {object[]} [errors]
 * @param {object[]} [warnings]
 */
export function renderUploadStatus(status, message, errors = [], warnings = []) {
  const { uploadStatus: el, dropZone } = getDom();
  if (!el) return;

  const cls = STATUS_CLASS[status] || STATUS_CLASS[UPLOAD_STATUS.IDLE];
  el.className = cls;
  el.hidden = false;

  const lines = [message].filter(Boolean);

  if (errors.length) {
    lines.push(
      `<span class="font-black uppercase text-[10px] tracking-wide">Errors</span>`,
    );
    lines.push(formatIssueList(errors));
  }

  if (warnings.length) {
    lines.push(
      `<span class="font-black uppercase text-[10px] tracking-wide mt-1 block">Warnings</span>`,
    );
    lines.push(formatIssueList(warnings));
  }

  el.innerHTML = lines.join("<br>");

  if (dropZone) {
    dropZone.classList.toggle("border-green-400", status === UPLOAD_STATUS.SUCCESS);
    dropZone.classList.toggle("border-amber-400", status === UPLOAD_STATUS.WARNING);
    dropZone.classList.toggle("border-red-400", status === UPLOAD_STATUS.ERROR);
    dropZone.classList.toggle(
      "border-gray-300",
      status === UPLOAD_STATUS.IDLE || status === UPLOAD_STATUS.PARSING,
    );
  }
}

/**
 * @param {object[]} issues
 */
function formatIssueList(issues) {
  const shown = issues.slice(0, MAX_UPLOAD_ISSUES_SHOWN);
  const list = shown.map((i) => `• ${escapeHtml(i.message)}`).join("<br>");
  if (issues.length > MAX_UPLOAD_ISSUES_SHOWN) {
    return `${list}<br>…and ${issues.length - MAX_UPLOAD_ISSUES_SHOWN} more`;
  }
  return list;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function syncUploadStatusFromState() {
  const state = getState();
  renderUploadStatus(
    state.uploadStatus,
    state.uploadMessage,
    state.errors,
    state.warnings,
  );
}

export function initUploadUi() {
  const { uploadStatus } = getDom();
  if (uploadStatus) {
    uploadStatus.hidden = true;
    uploadStatus.textContent = "";
  }
}
