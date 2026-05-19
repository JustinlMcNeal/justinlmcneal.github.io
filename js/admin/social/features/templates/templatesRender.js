// Templates tab — list rendering and row handlers

import { getTemplatesContext } from "./templatesContext.js";
import { editTemplate, removeTemplate } from "./templateActions.js";

export function renderTemplateList(tone = "casual") {
  const { state, els } = getTemplatesContext();
  const filtered = state.templates.filter(t => t.tone === tone);

  if (!filtered.length) {
    els.templateList.innerHTML = `
      <div class="p-8 text-center text-gray-400">
        <p>No templates for this tone</p>
      </div>
    `;
    return;
  }

  els.templateList.innerHTML = filtered.map(template => `
    <div class="template-item" data-template-id="${template.id}">
      <div class="template-item-content">${template.template}</div>
      <div class="template-item-actions">
        <button class="btn-edit-template p-2 hover:bg-gray-100 rounded" title="Edit">\u270f\ufe0f</button>
        <button class="btn-delete-template p-2 hover:bg-red-50 rounded text-red-500" title="Delete">\ud83d\uddd1\ufe0f</button>
      </div>
    </div>
  `).join("");

  els.templateList.querySelectorAll(".btn-edit-template").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const templateId = btn.closest(".template-item").dataset.templateId;
      const template = state.templates.find(t => t.id === templateId);
      if (template) {
        const newText = prompt("Edit template:", template.template);
        if (newText && newText !== template.template) editTemplate(templateId, newText);
      }
    });
  });

  els.templateList.querySelectorAll(".btn-delete-template").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const templateId = btn.closest(".template-item").dataset.templateId;
      if (confirm("Delete this template?")) removeTemplate(templateId);
    });
  });
}
