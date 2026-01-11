import { createBanner, updateBanner, deleteBanner, uploadBannerImage } from "./api.js";

let onSuccessCallback = null;
let currentId = null;

const dialog = document.getElementById("bannerModal");
const form = document.getElementById("bannerForm");
const title = document.getElementById("modalTitle");
const dropZone = document.getElementById("dropZone");
const fileInput = document.getElementById("fileInput");
const imgPreview = document.getElementById("imagePreview");
const previewArea = document.getElementById("previewArea");
const btnDelete = document.getElementById("btnDelete");

export function openModal(banner, onSuccess) {
    onSuccessCallback = onSuccess;
    form.reset();
    imgPreview.src = "";
    imgPreview.classList.add("hidden");
    previewArea.classList.remove("hidden");
    
    if (banner) {
        currentId = banner.id;
        title.textContent = "Edit Banner";
        
        // Populate fields
        form.querySelector('[name="id"]').value = banner.id;
        form.querySelector('[name="title"]').value = banner.title;
        form.querySelector('[name="subtitle"]').value = banner.subtitle || "";
        form.querySelector('[name="label"]').value = banner.label || "";
        form.querySelector('[name="link_url"]').value = banner.link_url || "";
        form.querySelector('[name="btn_text"]').value = banner.btn_text || "";
        form.querySelector('[name="image_url"]').value = banner.image_url;
        form.querySelector('[name="active"]').checked = banner.active;
        
        // Show Image
        imgPreview.src = banner.image_url;
        imgPreview.classList.remove("hidden");
        previewArea.classList.add("hidden");

        btnDelete.classList.remove("hidden");
    } else {
        currentId = null;
        title.textContent = "New Banner";
        btnDelete.classList.add("hidden");
    }
    
    dialog.showModal();
}

// Close Helpers
dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
});
document.getElementById("btnCloseModal").addEventListener("click", () => dialog.close());

// Drag & Drop
dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("bg-gray-100", "border-black");
});

dropZone.addEventListener("dragleave", (e) => {
    e.preventDefault();
    dropZone.classList.remove("bg-gray-100", "border-black");
});

dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("bg-gray-100", "border-black");
    if(e.dataTransfer.files.length) {
        handleFile(e.dataTransfer.files[0]);
    }
});

fileInput.addEventListener("change", (e) => {
    if(e.target.files.length) handleFile(e.target.files[0]);
});

async function handleFile(file) {
    if (!file.type.startsWith("image/")) return;

    // Show local preview immediately
    const reader = new FileReader();
    reader.onload = (e) => {
        imgPreview.src = e.target.result;
        imgPreview.classList.remove("hidden");
        previewArea.classList.add("hidden");
    };
    reader.readAsDataURL(file);

    try {
        // Upload immediately
        dropZone.classList.add("opacity-50", "pointer-events-none");
        const url = await uploadBannerImage(file);
        form.querySelector('[name="image_url"]').value = url;
    } catch (err) {
        console.error("Upload failed", err);
        alert("Failed to upload image.");
    } finally {
        dropZone.classList.remove("opacity-50", "pointer-events-none");
    }
}

// Submit
form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    
    // Validate
    if(!fd.get("image_url")) {
        alert("Please upload an image");
        return;
    }

    const payload = {
        title: fd.get("title"),
        subtitle: fd.get("subtitle"),
        label: fd.get("label"),
        link_url: fd.get("link_url"),
        btn_text: fd.get("btn_text"),
        image_url: fd.get("image_url"),
        active: fd.get("active") === "on"
    };

    const submitBtn = form.querySelector('[type="submit"]');
    const originalText = submitBtn.textContent;
    submitBtn.textContent = "Saving...";
    submitBtn.disabled = true;

    try {
        if (currentId) {
            await updateBanner(currentId, payload);
        } else {
            await createBanner(payload);
        }
        dialog.close();
        if(onSuccessCallback) onSuccessCallback();
    } catch (err) {
        console.error(err);
        alert("Error saving banner");
    } finally {
        submitBtn.textContent = originalText;
        submitBtn.disabled = false;
    }
});

// Delete
btnDelete.addEventListener("click", async () => {
    if(!confirm("Are you sure you want to delete this banner?")) return;
    
    try {
        await deleteBanner(currentId);
        dialog.close();
        if(onSuccessCallback) onSuccessCallback();
    } catch(err) {
        console.error(err);
        alert("Failed to delete");
    }
});
