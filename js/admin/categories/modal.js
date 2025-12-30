export function bindCategoryModal(els, onSave) {
  let current = null;

  function open(category) {
    current = category || {};

    els.modalTitle.textContent = category ? "Edit Category" : "New Category";

    els.fName.value = current.name || "";
    els.fSlug.value = current.slug || "";
    els.fImage.value = current.home_image_path || "";
    els.fOrder.value = current.home_sort_order || 0;
    els.fActive.checked = current.is_active ?? true;

    els.modal.classList.remove("hidden");
  }

  function close() {
    els.modal.classList.add("hidden");
  }

  els.btnClose.addEventListener("click", close);

  els.btnSave.addEventListener("click", async () => {
    const payload = {
      id: current.id,
      name: els.fName.value.trim().toLowerCase(),
      slug: els.fSlug.value.trim().toLowerCase(),
      home_image_path: els.fImage.value.trim() || null,
      home_sort_order: Number(els.fOrder.value || 0),
      is_active: els.fActive.checked
    };

    await onSave(payload);
    close();
  });

  return { open };
}
