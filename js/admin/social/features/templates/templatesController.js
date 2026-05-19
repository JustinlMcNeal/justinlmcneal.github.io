// Templates tab — init, setup, load

import { fetchTemplates } from "../../api.js";
import { initTemplatesContext, getTemplatesContext } from "./templatesContext.js";
import { renderTemplateList } from "./templatesRender.js";
import { addTemplate } from "./templateActions.js";

export function initTemplates(deps) {
  initTemplatesContext(deps);
}

export function setupTemplates() {
  const { els } = getTemplatesContext();

  document.querySelectorAll(".tone-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tone-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      renderTemplateList(tab.dataset.tone);
    });
  });
  document.querySelector('.tone-tab[data-tone="casual"]')?.classList.add("active");
  els.btnAddTemplate?.addEventListener("click", () => {
    const activeTone = document.querySelector(".tone-tab.active")?.dataset.tone || "casual";
    const template = prompt("Enter new caption template:\n\nUse placeholders: {product_name}, {category}, {link}");
    if (template) addTemplate(activeTone, template);
  });
}

export async function loadTemplates() {
  const { state } = getTemplatesContext();
  state.templates = await fetchTemplates();
  renderTemplateList();
}
