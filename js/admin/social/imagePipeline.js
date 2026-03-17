// /js/admin/social/imagePipeline.js
// AI Image Pipeline: generation, review queue, blacklist management

import { getSupabaseClient } from "../../shared/supabaseClient.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../../config/env.js";

const SUPABASE_FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;

const sb = () => {
  const client = getSupabaseClient();
  if (!client) throw new Error("Supabase client not initialized");
  return client;
};

// ============================================
// State
// ============================================

const imgState = {
  reviewImages: [],
  approvedImages: [],
  blacklistedImages: [],
  products: [],
  pipelineSettings: {},
  selectedBlacklistImages: new Set(),
  currentSubTab: "review",
};

// ============================================
// Data Loading
// ============================================

export async function loadImagePipelineData() {
  try {
    await Promise.all([
      loadReviewQueue(),
      loadApprovedImages(),
      loadBlacklist(),
      loadPipelineSettings(),
    ]);
    updateStats();
  } catch (err) {
    console.error("[imagePipeline] Error loading data:", err);
  }
}

async function loadReviewQueue() {
  const { data, error } = await sb()
    .from("social_generated_images")
    .select("*, product:products(id, name, slug, catalog_image_url)")
    .eq("status", "pending_review")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[imagePipeline] Error loading review queue:", error);
    return;
  }
  imgState.reviewImages = data || [];
  renderReviewQueue();
}

async function loadApprovedImages() {
  const { data, error } = await sb()
    .from("social_generated_images")
    .select("*, product:products(id, name, slug)")
    .eq("status", "approved")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return;
  imgState.approvedImages = data || [];
  renderApprovedImages();
}

async function loadBlacklist() {
  const { data, error } = await sb()
    .from("image_blacklist")
    .select("*, product:products(id, name, slug)")
    .order("created_at", { ascending: false });

  if (error) return;
  imgState.blacklistedImages = data || [];
  renderBlacklist();
}

async function loadPipelineSettings() {
  const { data } = await sb()
    .from("social_settings")
    .select("setting_value")
    .eq("setting_key", "image_pipeline")
    .single();

  const defaults = {
    enabled: true,
    auto_generate: false,
    model: "gpt-image-1",
    quality: "high",
    size: "1024x1024",
    require_review: true,
    max_generations_per_day: 50,
    style_presets: ["lifestyle"],
    fallback_to_catalog: true,
  };

  if (!data?.setting_value) {
    // No settings row exists — create it
    imgState.pipelineSettings = defaults;
    try {
      await sb().from("social_settings").upsert(
        { setting_key: "image_pipeline", setting_value: defaults },
        { onConflict: "setting_key" }
      );
    } catch (e) {
      console.warn("[imagePipeline] Could not create default settings:", e);
    }
  } else {
    imgState.pipelineSettings = data.setting_value;
  }

  // Populate settings UI
  const el = (id) => document.getElementById(id);
  if (el("pipelineModel")) el("pipelineModel").value = imgState.pipelineSettings.model || "gpt-image-1";
  if (el("pipelineQuality")) el("pipelineQuality").value = imgState.pipelineSettings.quality || "high";
  if (el("pipelineMaxDaily")) el("pipelineMaxDaily").value = imgState.pipelineSettings.max_generations_per_day || 50;
  if (el("pipelineStyle")) el("pipelineStyle").value = imgState.pipelineSettings.style_presets?.[0] || "lifestyle";
  if (el("pipelineEnabled")) el("pipelineEnabled").checked = imgState.pipelineSettings.enabled || false;
  if (el("pipelineRequireReview")) el("pipelineRequireReview").checked = imgState.pipelineSettings.require_review !== false;
}

function updateStats() {
  const el = (id) => document.getElementById(id);
  if (el("imgStatPending")) el("imgStatPending").textContent = imgState.reviewImages.length;
  if (el("imgStatApproved")) el("imgStatApproved").textContent = imgState.approvedImages.length;
  if (el("reviewCount")) el("reviewCount").textContent = imgState.reviewImages.length;

  // Count rejected from a separate query would be ideal, but for now use the stat
  sb()
    .from("social_generated_images")
    .select("id", { count: "exact", head: true })
    .eq("status", "rejected")
    .then(({ count }) => {
      if (el("imgStatRejected")) el("imgStatRejected").textContent = count || 0;
    });

  if (el("imgStatBlacklisted")) el("imgStatBlacklisted").textContent = imgState.blacklistedImages.length;
}

// ============================================
// Rendering
// ============================================

function renderReviewQueue() {
  const grid = document.getElementById("reviewQueueGrid");
  const empty = document.getElementById("reviewQueueEmpty");
  if (!grid) return;

  if (!imgState.reviewImages.length) {
    grid.innerHTML = "";
    if (empty) empty.classList.remove("hidden");
    return;
  }

  if (empty) empty.classList.add("hidden");

  grid.innerHTML = imgState.reviewImages
    .map(
      (img) => `
    <div class="bg-white border rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow" data-img-id="${img.id}">
      <div class="relative">
        <img src="${img.public_url}" alt="${img.product?.name || 'AI Generated'}" 
             class="w-full aspect-square object-cover" loading="lazy">
        <span class="absolute top-2 left-2 px-2 py-1 bg-yellow-500 text-white text-xs font-bold rounded-full">
          Pending
        </span>
        <span class="absolute top-2 right-2 px-2 py-1 bg-black/60 text-white text-xs rounded-full">
          ${img.style || "lifestyle"}
        </span>
      </div>
      <div class="p-3">
        <p class="font-medium text-sm truncate">${img.product?.name || "Unknown Product"}</p>
        <p class="text-xs text-gray-500 mt-1">
          ${img.model} · ${img.quality} · $${((img.generation_cost_cents || 8) / 100).toFixed(2)}
        </p>
        <p class="text-xs text-gray-400 mt-1">${new Date(img.created_at).toLocaleDateString()}</p>
        <div class="flex gap-2 mt-3">
          <button onclick="window._imagePipeline.approveImage('${img.id}')" 
                  class="flex-1 py-2 text-sm font-bold bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors">
            ✅ Approve
          </button>
          <button onclick="window._imagePipeline.rejectImage('${img.id}')" 
                  class="flex-1 py-2 text-sm font-bold bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors">
            ❌ Reject
          </button>
        </div>
      </div>
    </div>
  `
    )
    .join("");
}

function renderApprovedImages() {
  const grid = document.getElementById("approvedGrid");
  const empty = document.getElementById("approvedEmpty");
  if (!grid) return;

  if (!imgState.approvedImages.length) {
    grid.innerHTML = "";
    if (empty) empty.classList.remove("hidden");
    return;
  }

  if (empty) empty.classList.add("hidden");

  grid.innerHTML = imgState.approvedImages
    .map(
      (img) => `
    <div class="border rounded-xl overflow-hidden hover:shadow-md transition-shadow">
      <img src="${img.public_url}" alt="${img.product?.name || 'AI Generated'}" 
           class="w-full aspect-square object-cover" loading="lazy">
      <div class="p-2">
        <p class="text-xs font-medium truncate">${img.product?.name || "Unknown"}</p>
        <p class="text-xs text-gray-400">${img.style} · ${new Date(img.created_at).toLocaleDateString()}</p>
      </div>
    </div>
  `
    )
    .join("");
}

function renderBlacklist() {
  const grid = document.getElementById("blacklistGrid");
  const empty = document.getElementById("blacklistEmpty");
  if (!grid) return;

  if (!imgState.blacklistedImages.length) {
    grid.innerHTML = "";
    if (empty) empty.classList.remove("hidden");
    return;
  }

  if (empty) empty.classList.add("hidden");

  grid.innerHTML = imgState.blacklistedImages
    .map(
      (item) => `
    <div class="border rounded-xl overflow-hidden hover:shadow-md transition-shadow relative group">
      <img src="${item.image_url}" alt="Blacklisted" 
           class="w-full aspect-square object-cover opacity-60" loading="lazy">
      <div class="absolute inset-0 bg-red-500/10 flex items-center justify-center">
        <span class="text-3xl">🚫</span>
      </div>
      <div class="p-2">
        <p class="text-xs font-medium truncate">${item.product?.name || "Unknown"}</p>
        <p class="text-xs text-gray-400 truncate">${item.reason || "No reason"}</p>
        <button onclick="window._imagePipeline.removeFromBlacklist('${item.id}')" 
                class="mt-1 text-xs text-blue-600 hover:underline">Remove</button>
      </div>
    </div>
  `
    )
    .join("");
}

// ============================================
// Actions
// ============================================

export async function approveImage(imageId) {
  try {
    const { error } = await sb()
      .from("social_generated_images")
      .update({
        status: "approved",
        reviewed_at: new Date().toISOString(),
        reviewed_by: "admin",
      })
      .eq("id", imageId);

    if (error) throw error;

    // Also update any pending_review posts that use this image
    const { data: img } = await sb()
      .from("social_generated_images")
      .select("product_id, public_url")
      .eq("id", imageId)
      .single();

    if (img) {
      // Find posts waiting for this image's review
      const { data: pendingPosts } = await sb()
        .from("social_posts")
        .select("id, variation_id")
        .eq("generated_image_id", imageId)
        .eq("status", "pending_review");

      if (pendingPosts?.length) {
        for (const post of pendingPosts) {
          // Update variation with the approved image URL
          if (post.variation_id) {
            await sb()
              .from("social_variations")
              .update({ image_path: img.public_url })
              .eq("id", post.variation_id);
          }
          // Move post to queued
          await sb()
            .from("social_posts")
            .update({ status: "queued", requires_approval: false })
            .eq("id", post.id);
        }
        console.log(`[imagePipeline] Approved image → ${pendingPosts.length} posts moved to queued`);
      }
    }

    // Refresh data
    await loadImagePipelineData();
    showToast("Image approved!", "success");
  } catch (err) {
    console.error("[imagePipeline] Error approving:", err);
    showToast("Failed to approve image", "error");
  }
}

export async function rejectImage(imageId) {
  const reason = prompt("Rejection reason (optional):");

  try {
    const { error } = await sb()
      .from("social_generated_images")
      .update({
        status: "rejected",
        reviewed_at: new Date().toISOString(),
        reviewed_by: "admin",
        rejection_reason: reason || null,
      })
      .eq("id", imageId);

    if (error) throw error;

    // Delete any pending_review posts that depend on this image
    const { data: pendingPosts } = await sb()
      .from("social_posts")
      .select("id")
      .eq("generated_image_id", imageId)
      .eq("status", "pending_review");

    if (pendingPosts?.length) {
      const postIds = pendingPosts.map((p) => p.id);
      await sb().from("social_posts").delete().in("id", postIds);
      console.log(`[imagePipeline] Rejected image → ${postIds.length} pending posts deleted`);
    }

    await loadImagePipelineData();
    showToast("Image rejected", "info");
  } catch (err) {
    console.error("[imagePipeline] Error rejecting:", err);
    showToast("Failed to reject image", "error");
  }
}

export async function removeFromBlacklist(blacklistId) {
  try {
    const { error } = await sb()
      .from("image_blacklist")
      .delete()
      .eq("id", blacklistId);

    if (error) throw error;
    await loadBlacklist();
    updateStats();
    showToast("Image removed from blacklist", "success");
  } catch (err) {
    console.error("[imagePipeline] Error removing from blacklist:", err);
  }
}

export async function blacklistImage(productId, imageUrl, reason) {
  try {
    const { error } = await sb()
      .from("image_blacklist")
      .upsert(
        {
          product_id: productId,
          image_url: imageUrl,
          reason: reason || null,
        },
        { onConflict: "product_id,image_url" }
      );

    if (error) throw error;
    await loadBlacklist();
    updateStats();
    showToast("Image blacklisted", "success");
  } catch (err) {
    console.error("[imagePipeline] Error blacklisting:", err);
    showToast("Failed to blacklist image", "error");
  }
}

// ============================================
// Generate Images
// ============================================

export async function triggerGeneration(productId, styles, count) {
  const el = (id) => document.getElementById(id);
  const progressEl = el("genProgress");
  const progressText = el("genProgressText");
  const resultsEl = el("genResults");
  const runBtn = el("btnRunGenerate");

  // Normalize styles to array
  const stylesArr = Array.isArray(styles) ? styles : [styles || "lifestyle"];

  // Hide any previous results, show progress
  if (resultsEl) resultsEl.classList.add("hidden");
  if (progressEl) progressEl.classList.remove("hidden");
  if (runBtn) runBtn.disabled = true;

  // Timer so user knows it's still working
  const startTime = Date.now();
  const timer = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    if (progressText) progressText.textContent = `Generating images... (${elapsed}s)`;
  }, 1000);

  try {
    if (progressText) progressText.textContent = "Generating images... (0s)";

    const body = productId === "__all__"
      ? { batch: true, product_ids: imgState.products.map((p) => p.id), styles: stylesArr, count }
      : { product_id: productId, styles: stylesArr, count };

    const { data: { session } } = await sb().auth.getSession();
    const token = session?.access_token || SUPABASE_ANON_KEY;

    const resp = await fetch(`${SUPABASE_FUNCTIONS_URL}/generate-social-image`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    clearInterval(timer);

    if (!resp.ok) {
      const txt = await resp.text();
      let errMsg;
      try { errMsg = JSON.parse(txt).error; } catch { errMsg = `HTTP ${resp.status}: ${txt.substring(0, 100)}`; }
      if (progressText) progressText.textContent = `❌ Error: ${errMsg}`;
      showToast(`Generation failed: ${errMsg}`, "error");
      return;
    }

    const result = await resp.json();

    const successful = result.results?.filter((r) => r.success) || [];
    const failed = result.results?.filter((r) => !r.success) || [];

    if (successful.length === 0 && failed.length > 0) {
      // All images failed
      const errMsg = failed[0].error || "Unknown generation error";
      if (progressText) progressText.textContent = `❌ Generation failed: ${errMsg}`;
      showToast(`Generation failed: ${errMsg}`, "error");
      return;
    }

    // Show results with image previews
    if (progressEl) progressEl.classList.add("hidden");

    if (resultsEl && successful.length > 0) {
      const statusBadge = (status, score) => {
        if (status === "approved") return `<span class="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-bold rounded-full">✅ Auto-Approved (${score}/10)</span>`;
        if (status === "rejected") return `<span class="px-2 py-0.5 bg-red-100 text-red-700 text-xs font-bold rounded-full">❌ Rejected (${score}/10)</span>`;
        return `<span class="px-2 py-0.5 bg-yellow-100 text-yellow-700 text-xs font-bold rounded-full">⏳ Pending Review (${score}/10)</span>`;
      };

      const approvedCount = successful.filter(r => r.status === "approved").length;
      const pendingCount = successful.filter(r => r.status === "pending_review").length;
      const rejectedCount = successful.filter(r => r.status === "rejected").length;

      resultsEl.innerHTML = `
        <div class="space-y-3">
          <div class="flex items-center justify-between">
            <p class="text-sm font-bold text-green-700">🎉 Generated ${successful.length} image${successful.length > 1 ? "s" : ""} (${result.total_cost_display || "$0.00"})</p>
            ${failed.length ? `<p class="text-xs text-red-500">${failed.length} failed</p>` : ""}
          </div>
          <div class="grid grid-cols-${Math.min(successful.length, 3)} gap-3">
            ${successful.map(r => `
              <div class="border rounded-xl overflow-hidden">
                ${r.public_url 
                  ? `<img src="${r.public_url}" alt="${r.product_name}" class="w-full aspect-square object-cover">`
                  : `<div class="w-full aspect-square bg-gray-100 flex items-center justify-center text-gray-400 text-xs">No preview</div>`
                }
                <div class="p-2 space-y-1">
                  <p class="text-xs font-medium truncate">${r.product_name}</p>
                  ${statusBadge(r.status, r.quality_score)}
                  <p class="text-xs text-gray-400">${r.quality_feedback || ""}</p>
                  <p class="text-xs text-gray-400">${r.model} · ${r.mode}</p>
                </div>
              </div>
            `).join("")}
          </div>
          <div class="flex gap-2 pt-2">
            ${approvedCount ? `<button onclick="switchImageSubTab('approved'); document.getElementById('generateImagesModal').classList.add('hidden');" class="flex-1 py-2 text-sm font-bold bg-green-500 text-white rounded-lg hover:bg-green-600">View Approved (${approvedCount})</button>` : ""}
            ${pendingCount ? `<button onclick="switchImageSubTab('review'); document.getElementById('generateImagesModal').classList.add('hidden');" class="flex-1 py-2 text-sm font-bold bg-yellow-500 text-white rounded-lg hover:bg-yellow-600">Review Queue (${pendingCount})</button>` : ""}
            <button onclick="document.getElementById('genResults').classList.add('hidden');" class="px-4 py-2 text-sm font-medium border rounded-lg hover:bg-gray-50">Close</button>
          </div>
        </div>
      `;
      resultsEl.classList.remove("hidden");
    }

    const msg = `Generated ${successful.length} image${successful.length > 1 ? "s" : ""} (${result.total_cost_display || "$0.00"})`;
    showToast(msg, "success");

    // Refresh all data
    await loadImagePipelineData();

  } catch (err) {
    clearInterval(timer);
    console.error("[imagePipeline] Generation error:", err);
    if (progressText) progressText.textContent = `❌ Error: ${err.message}`;
    showToast("Generation failed — check console for details", "error");
  } finally {
    if (runBtn) runBtn.disabled = false;
  }
}

// ============================================
// Save Pipeline Settings
// ============================================

export async function savePipelineSettings() {
  const el = (id) => document.getElementById(id);
  const settings = {
    enabled: el("pipelineEnabled")?.checked || false,
    auto_generate: el("pipelineEnabled")?.checked || false,
    model: el("pipelineModel")?.value || "dall-e-3",
    quality: el("pipelineQuality")?.value || "hd",
    size: "1024x1024",
    style_presets: [el("pipelineStyle")?.value || "lifestyle"],
    require_review: el("pipelineRequireReview")?.checked !== false,
    max_generations_per_day: parseInt(el("pipelineMaxDaily")?.value) || 50,
    fallback_to_catalog: true,
  };

  try {
    // Use upsert so settings are created if they don't exist yet
    const { error } = await sb()
      .from("social_settings")
      .upsert(
        { setting_key: "image_pipeline", setting_value: settings },
        { onConflict: "setting_key" }
      );

    if (error) throw error;
    imgState.pipelineSettings = settings;
    showToast("Pipeline settings saved", "success");
  } catch (err) {
    console.error("[imagePipeline] Error saving settings:", err);
    showToast("Failed to save settings", "error");
  }
}

// ============================================
// Sub-tab switching
// ============================================

export function switchImageSubTab(tab) {
  imgState.currentSubTab = tab;
  const panels = ["review", "approved", "blacklist"];
  const el = (id) => document.getElementById(id);

  panels.forEach((p) => {
    const panel = el(`imgPanel${p.charAt(0).toUpperCase() + p.slice(1)}`);
    const btn = el(`imgSub${p.charAt(0).toUpperCase() + p.slice(1)}`);
    if (panel) panel.classList.toggle("hidden", p !== tab);
    if (btn) {
      btn.classList.toggle("border-black", p === tab);
      btn.classList.toggle("text-black", p === tab);
      btn.classList.toggle("border-transparent", p !== tab);
      btn.classList.toggle("text-gray-500", p !== tab);
    }
  });
}

// ============================================
// Setup Event Listeners
// ============================================

export function setupImagePipeline(products) {
  imgState.products = products || [];
  const el = (id) => document.getElementById(id);

  // Make functions globally accessible for onclick handlers
  window._imagePipeline = {
    approveImage,
    rejectImage,
    removeFromBlacklist,
  };

  // Make sub-tab switching global
  window.switchImageSubTab = switchImageSubTab;

  // Generate Images button → open modal
  el("btnGenerateImages")?.addEventListener("click", () => {
    openGenerateModal();
  });

  // Populate product selects
  populateProductSelects(products);

  // Generate button in modal
  el("btnRunGenerate")?.addEventListener("click", () => {
    const productId = el("genProductSelect")?.value;
    // Collect ALL selected styles (multi-select)
    const selectedBtns = document.querySelectorAll(".gen-style-btn.bg-purple-100");
    const styles = Array.from(selectedBtns).map((b) => b.dataset.style).filter(Boolean);
    if (styles.length === 0) styles.push("lifestyle"); // fallback
    const count = parseInt(el("genCount")?.value) || 1;

    if (!productId) {
      showToast("Please select a product", "error");
      return;
    }
    triggerGeneration(productId, styles, count);
  });

  // Style buttons in generate modal — toggle multi-select
  document.querySelectorAll(".gen-style-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const isSelected = btn.classList.contains("bg-purple-100");
      if (isSelected) {
        // Deselect — but ensure at least one stays selected
        const totalSelected = document.querySelectorAll(".gen-style-btn.bg-purple-100").length;
        if (totalSelected <= 1) return; // can't deselect the last one
        btn.classList.remove("bg-purple-100", "border-purple-300");
        btn.classList.add("hover:bg-gray-50");
      } else {
        // Select
        btn.classList.add("bg-purple-100", "border-purple-300");
        btn.classList.remove("hover:bg-gray-50");
      }
    });
  });

  // Cost estimate update
  el("genCount")?.addEventListener("change", updateCostEstimate);
  el("genProductSelect")?.addEventListener("change", updateCostEstimate);

  // Save pipeline settings
  el("btnSavePipelineSettings")?.addEventListener("click", savePipelineSettings);

  // Blacklist button → open modal
  el("btnAddBlacklist")?.addEventListener("click", () => {
    openBlacklistModal();
  });

  // Blacklist product select → load images
  el("blProductSelect")?.addEventListener("change", async () => {
    const productId = el("blProductSelect").value;
    if (!productId) {
      el("blImageGrid")?.classList.add("hidden");
      return;
    }
    await loadProductImagesForBlacklist(productId);
  });

  // Confirm blacklist
  el("btnConfirmBlacklist")?.addEventListener("click", async () => {
    const productId = el("blProductSelect")?.value;
    const reason = el("blReason")?.value || "";

    for (const imageUrl of imgState.selectedBlacklistImages) {
      await blacklistImage(productId, imageUrl, reason);
    }

    imgState.selectedBlacklistImages.clear();
    el("blacklistModal")?.classList.add("hidden");
  });
}

function openGenerateModal() {
  const modal = document.getElementById("generateImagesModal");
  if (modal) {
    modal.classList.remove("hidden");
    modal.classList.add("flex");
  }
  updateCostEstimate();
}

function openBlacklistModal() {
  const modal = document.getElementById("blacklistModal");
  if (modal) {
    modal.classList.remove("hidden");
    modal.classList.add("flex");
  }
  imgState.selectedBlacklistImages.clear();
  const grid = document.getElementById("blImageGrid");
  if (grid) grid.classList.add("hidden");
  const btn = document.getElementById("btnConfirmBlacklist");
  if (btn) btn.disabled = true;
}

function populateProductSelects(products) {
  const genSelect = document.getElementById("genProductSelect");
  const blSelect = document.getElementById("blProductSelect");

  const options = products
    .map((p) => `<option value="${p.id}">${p.name}</option>`)
    .join("");

  if (genSelect) {
    genSelect.innerHTML = `<option value="">-- Choose a product --</option><option value="__all__">All Products (batch)</option>${options}`;
  }
  if (blSelect) {
    blSelect.innerHTML = `<option value="">-- Choose a product --</option>${options}`;
  }
}

async function loadProductImagesForBlacklist(productId) {
  const grid = document.getElementById("blImageGrid");
  if (!grid) return;

  grid.classList.remove("hidden");
  grid.innerHTML = '<p class="col-span-3 text-center text-sm text-gray-400 py-4">Loading images...</p>';

  // Get catalog image + gallery images
  const product = imgState.products.find((p) => p.id === productId);
  const images = [];

  if (product?.catalog_image_url) {
    images.push({ url: product.catalog_image_url, label: "Main" });
  }

  const { data: gallery } = await sb()
    .from("product_gallery_images")
    .select("url, position")
    .eq("product_id", productId)
    .order("position");

  (gallery || []).forEach((g, i) => {
    images.push({ url: g.url, label: `Gallery ${i + 1}` });
  });

  // Check which are already blacklisted
  const { data: existing } = await sb()
    .from("image_blacklist")
    .select("image_url")
    .eq("product_id", productId);

  const alreadyBlacklisted = new Set((existing || []).map((e) => e.image_url));

  imgState.selectedBlacklistImages.clear();

  grid.innerHTML = images
    .map((img) => {
      const isBlacklisted = alreadyBlacklisted.has(img.url);
      return `
      <div class="relative cursor-pointer border-2 rounded-lg overflow-hidden transition-all ${
        isBlacklisted ? "border-red-300 opacity-50" : "border-transparent hover:border-gray-300"
      }" 
           onclick="${isBlacklisted ? "" : `window._imagePipeline_toggleBlacklistImage(this, '${encodeURIComponent(img.url)}')`}">
        <img src="${img.url}" class="w-full aspect-square object-cover" loading="lazy">
        <span class="absolute bottom-0 left-0 right-0 text-center text-xs py-1 bg-black/60 text-white">
          ${img.label}${isBlacklisted ? " (already)" : ""}
        </span>
        ${isBlacklisted ? '<div class="absolute inset-0 flex items-center justify-center"><span class="text-2xl">🚫</span></div>' : ""}
      </div>
    `;
    })
    .join("");

  // Global helper for toggle
  window._imagePipeline_toggleBlacklistImage = (el, encodedUrl) => {
    const url = decodeURIComponent(encodedUrl);
    if (imgState.selectedBlacklistImages.has(url)) {
      imgState.selectedBlacklistImages.delete(url);
      el.classList.remove("border-red-500", "ring-2", "ring-red-300");
      el.classList.add("border-transparent");
    } else {
      imgState.selectedBlacklistImages.add(url);
      el.classList.add("border-red-500", "ring-2", "ring-red-300");
      el.classList.remove("border-transparent");
    }
    const btn = document.getElementById("btnConfirmBlacklist");
    if (btn) btn.disabled = imgState.selectedBlacklistImages.size === 0;
  };
}

function updateCostEstimate() {
  const el = (id) => document.getElementById(id);
  const count = parseInt(el("genCount")?.value) || 1;
  const productVal = el("genProductSelect")?.value;
  const numProducts = productVal === "__all__" ? imgState.products.length : productVal ? 1 : 0;
  const totalImages = numProducts * count;
  const costPerImage = 0.08; // HD DALL-E 3
  const totalCost = (totalImages * costPerImage).toFixed(2);

  if (el("genCostEstimate")) {
    el("genCostEstimate").textContent = `$${totalCost} (${totalImages} images)`;
  }
}

// ============================================
// Toast helper (matches existing pattern or falls back)
// ============================================

function showToast(message, type = "info") {
  // Try to use existing toast if available
  if (window.showToast) {
    window.showToast(message, type);
    return;
  }

  // Fallback toast
  const toast = document.createElement("div");
  toast.className = `fixed bottom-4 right-4 z-[999] px-4 py-3 rounded-lg shadow-lg text-sm font-medium text-white transition-opacity duration-300 ${
    type === "success"
      ? "bg-green-500"
      : type === "error"
        ? "bg-red-500"
        : "bg-gray-800"
  }`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}
