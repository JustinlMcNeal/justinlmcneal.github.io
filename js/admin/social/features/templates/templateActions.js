// Template CRUD actions

import {
  createTemplate,
  updateTemplate,
  deleteTemplate,
} from "../../api.js";
import { clearTemplateCache } from "../../captions.js";

export async function addTemplate(tone, template) {
  try {
    await createTemplate({ tone, template, is_active: true });
    clearTemplateCache();
    const { loadTemplates } = await import("./templatesController.js");
    await loadTemplates();
  } catch (err) {
    console.error("Add template error:", err);
    alert("Failed to add template");
  }
}

export async function editTemplate(templateId, newText) {
  try {
    await updateTemplate(templateId, { template: newText });
    clearTemplateCache();
    const { loadTemplates } = await import("./templatesController.js");
    await loadTemplates();
  } catch (err) {
    console.error("Edit template error:", err);
    alert("Failed to update template");
  }
}

export async function removeTemplate(templateId) {
  try {
    await deleteTemplate(templateId);
    clearTemplateCache();
    const { loadTemplates } = await import("./templatesController.js");
    await loadTemplates();
  } catch (err) {
    console.error("Delete template error:", err);
    alert("Failed to delete template");
  }
}
