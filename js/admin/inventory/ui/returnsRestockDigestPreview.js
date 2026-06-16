/**
 * Returns/restock digest preview modal (Phase 10W — preview only unless explicitly confirmed).
 */

import { esc } from "../utils/formatters.js";
import { showInventoryToast } from "../events.js";
import {
  previewReturnsRestockDigest,
  sendReturnsRestockDigest,
} from "../api/returnsRestockDigestApi.js";
import { getDom } from "../dom.js";

/** @type {object|null} */
let lastPreview = null;

function closePreview() {
  const mount = getDom().returnsRestockDigestPreviewMount;
  if (mount) mount.innerHTML = "";
  document.body.classList.remove("overflow-hidden");
  lastPreview = null;
}

function summaryChips(summary) {
  if (!summary) return "";
  const entries = [
    ["Ready", summary.ready_to_restock],
    ["Stale", summary.stale_observations],
    ["Follow-ups", summary.open_channel_followups],
    ["Overdue F/U", summary.overdue_followups],
    ["Manual", summary.blocked_manual_review],
    ["Attention", summary.dashboard_attention_count],
  ];
  return entries
    .map(
      ([label, val]) =>
        `<span class="inline-flex flex-col border px-2 py-1 rounded text-teal-900 border-teal-400">
          <span class="text-[8px] font-black uppercase">${esc(label)}</span>
          <span class="text-sm font-black tabular-nums">${val ?? 0}</span>
        </span>`,
    )
    .join("");
}

function renderPreview(data) {
  const emailNote = data.email_configured
    ? `<p class="text-[10px] text-emerald-800">Email delivery is configured. “Send digest now” will email the configured recipient.</p>`
    : `<p class="text-[10px] text-amber-800">Email not configured — send will log a run only. Set RESEND_API_KEY + RETURNS_RESTOCK_DIGEST_EMAIL_TO to enable email.</p>`;

  return `
    <div class="fixed inset-0 z-[90] flex items-start justify-center bg-black/40 p-4 overflow-y-auto" data-digest-preview-modal>
      <div class="bg-white rounded-lg shadow-xl w-full max-w-3xl my-4 flex flex-col max-h-[92vh]">
        <div class="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <div>
            <h2 class="text-sm font-black uppercase tracking-wide">Digest Preview</h2>
            <p class="text-[10px] text-gray-500">Read-only summary — preview does not send or mutate inventory.</p>
          </div>
          <button type="button" data-digest-close class="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
        </div>
        <div class="px-4 py-2 border-b border-gray-100 flex flex-wrap gap-1.5">${summaryChips(data.summary)}</div>
        ${emailNote}
        <div class="px-4 py-2 flex flex-wrap gap-2 border-b border-gray-100">
          <button type="button" data-digest-copy-text class="text-[9px] font-black uppercase border px-2 py-1 rounded">Copy Text</button>
          <button type="button" data-digest-copy-html class="text-[9px] font-black uppercase border px-2 py-1 rounded">Copy HTML</button>
          <button type="button" data-digest-send class="text-[9px] font-black uppercase border-2 border-violet-700 text-violet-900 px-2 py-1 rounded bg-violet-50">Send Digest Now</button>
        </div>
        <pre class="p-4 text-[11px] overflow-y-auto flex-1 whitespace-pre-wrap font-mono text-gray-800 bg-slate-50 m-4 rounded border border-gray-200 max-h-[50vh]">${esc(data.text || "")}</pre>
      </div>
    </div>`;
}

function wirePreview(mount) {
  mount.querySelector("[data-digest-close]")?.addEventListener("click", closePreview);
  mount.querySelector("[data-digest-preview-modal]")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closePreview();
  });

  mount.querySelector("[data-digest-copy-text]")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(lastPreview?.text || "");
      showInventoryToast("Digest text copied.", { variant: "success" });
    } catch {
      showInventoryToast("Could not copy.", { variant: "error" });
    }
  });

  mount.querySelector("[data-digest-copy-html]")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(lastPreview?.html || "");
      showInventoryToast("Digest HTML copied.", { variant: "success" });
    } catch {
      showInventoryToast("Could not copy.", { variant: "error" });
    }
  });

  mount.querySelector("[data-digest-send]")?.addEventListener("click", async () => {
    if (!window.confirm("Send returns/restock digest now? This may email the configured admin recipient.")) {
      return;
    }
    try {
      const result = await sendReturnsRestockDigest("manual");
      if (result.skipped_duplicate) {
        showInventoryToast("Digest already sent for this window.", { variant: "info" });
      } else if (result.ok) {
        showInventoryToast(
          result.delivery_channel === "email" ? "Digest sent via email." : "Digest run logged (no email configured).",
          { variant: "success" },
        );
      } else {
        showInventoryToast(result.error || "Send failed.", { variant: "error" });
      }
    } catch (err) {
      showInventoryToast(err instanceof Error ? err.message : String(err), { variant: "error" });
    }
  });
}

/** @param {"daily"|"weekly"|"manual"} [runType] */
export async function openReturnsRestockDigestPreview(runType = "daily") {
  const mount = getDom().returnsRestockDigestPreviewMount;
  if (!mount) {
    showInventoryToast("Digest preview mount missing.", { variant: "error" });
    return;
  }

  mount.innerHTML = `<p class="fixed inset-0 z-[90] flex items-center justify-center bg-black/30 text-white text-sm">Loading digest…</p>`;
  document.body.classList.add("overflow-hidden");

  try {
    const data = await previewReturnsRestockDigest(runType);
    lastPreview = data;
    mount.innerHTML = renderPreview(data);
    wirePreview(mount);
  } catch (err) {
    mount.innerHTML = `<p class="p-4 text-red-700">${esc(err instanceof Error ? err.message : String(err))}</p>`;
  }
}
