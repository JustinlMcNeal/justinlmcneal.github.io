/**
 * editor.js — Quill rich-text editor helpers + description-mode state.
 *
 * `descState` is a shared mutable object.  Import it in any module that
 * needs to read or write the current visual/html mode for either modal.
 */

import { sanitizeForEbay, isComplexHtml } from "./utils.js";

// ── Quill toolbar config ──────────────────────────────────────
export const quillToolbar = [
  ["bold", "italic", "underline"],
  [{ header: [2, 3, false] }],
  [{ list: "ordered" }, { list: "bullet" }],
  [{ color: [] }],
  ["clean"],
];

/**
 * Shared description-mode state.
 * Mutate directly: `descState.pushMode = "html"`.
 */
export const descState = {
  pushMode: "visual",   // "visual" | "html"
  editMode: "visual",
};

/**
 * Destroy a previously-mounted Quill instance (its toolbar + content)
 * so a fresh one can be created without stacking toolbars.
 */
export function resetQuillEditorMount(editorId) {
  const editor = document.getElementById(editorId);
  if (!editor) return;
  editor.innerHTML = "";
  let prev = editor.previousElementSibling;
  while (prev && prev.classList?.contains("ql-toolbar")) {
    const toRemove = prev;
    prev = toRemove.previousElementSibling;
    toRemove.remove();
  }
}

/**
 * Switch the description panel between visual (Quill), raw HTML textarea,
 * and preview iframe.  Also updates the tab button active states.
 *
 * @param {"visual"|"html"|"preview"} mode
 * @param {"modal"|"edit"} prefix
 * @param {Quill|null} quillInstance
 */
export function toggleDescMode(mode, prefix, quillInstance) {
  const qlContainer = document.getElementById(`${prefix}DescriptionEditor`);
  const qlToolbar   = qlContainer.previousElementSibling;
  const textarea    = document.getElementById(`${prefix}DescriptionHtml`);
  const preview     = document.getElementById(`${prefix}DescriptionPreview`);
  const btnPrefix   = prefix === "modal" ? "Push" : "Edit";
  const btnVisual   = document.getElementById(`btn${btnPrefix}Visual`);
  const btnHtml     = document.getElementById(`btn${btnPrefix}Html`);
  const btnPreview  = document.getElementById(`btn${btnPrefix}Preview`);

  // Hide all panels, clear active states
  qlContainer.style.display = "none";
  if (qlToolbar?.classList?.contains("ql-toolbar")) qlToolbar.style.display = "none";
  textarea.classList.add("hidden");
  preview.classList.add("hidden");
  btnVisual.classList.remove("active");
  btnHtml.classList.remove("active");
  btnPreview.classList.remove("active");

  if (mode === "html") {
    // Sync Quill → textarea only when textarea is still empty
    if (quillInstance && !textarea.value.trim()) {
      const html = quillInstance.root.innerHTML;
      textarea.value = html === "<p><br></p>" ? "" : html;
    }
    textarea.classList.remove("hidden");
    btnHtml.classList.add("active");

  } else if (mode === "preview") {
    const html     = getDescriptionHtml(prefix, quillInstance);
    const safeHtml = sanitizeForEbay(html);
    /* eslint-disable no-useless-escape */
    preview.srcdoc = "<!DOCTYPE html><html><head><meta charset='utf-8'>" +
      "<style>body{margin:12px;font-family:Arial,sans-serif;color:#222;line-height:1.6;}<\/style>" +
      "<\/head><body>" + safeHtml + "<\/body><\/html>";
    /* eslint-enable no-useless-escape */
    preview.classList.remove("hidden");
    btnPreview.classList.add("active");

  } else {
    // Visual mode — sync textarea → Quill (only simple HTML)
    const val = textarea.value.trim();
    if (quillInstance && val && !isComplexHtml(val)) {
      quillInstance.root.innerHTML = val;
    }
    qlContainer.style.display = "";
    if (qlToolbar?.classList?.contains("ql-toolbar")) qlToolbar.style.display = "";
    btnVisual.classList.add("active");
  }
}

/**
 * Return the current description HTML from whichever panel is active.
 *
 * @param {"modal"|"edit"} prefix
 * @param {Quill|null} quillInstance
 * @returns {string}
 */
export function getDescriptionHtml(prefix, quillInstance) {
  const mode = prefix === "modal" ? descState.pushMode : descState.editMode;
  if (mode === "html") {
    return document.getElementById(`${prefix}DescriptionHtml`).value;
  }
  return quillInstance ? quillInstance.root.innerHTML : "";
}
