/**
 * images.js — Drag-and-drop image strip + gallery picker helpers.
 */

import { esc, buildImageUrls } from "./utils.js";

/**
 * Render a drag-and-drop image thumbnail strip.
 *
 * @param {string} containerId  - ID of the container element
 * @param {string[]} urls       - Ordered list of image URLs to display
 * @param {string[]} stateArr   - The live mutable array that backs `urls`
 *                                (same reference — mutations reflect immediately)
 * @param {number} [maxImages]  - Max images allowed in strip (default 24)
 */
export function renderImageStrip(containerId, urls, stateArr, maxImages = 24) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";

  urls.forEach((url, i) => {
    const thumb = document.createElement("div");
    thumb.className = "img-thumb" + (i === 0 ? " main" : "");
    thumb.draggable = true;
    thumb.dataset.idx = i;
    thumb.innerHTML = `<img src="${esc(url)}" alt="img ${i + 1}" /><span class="img-remove">&times;</span>`;

    thumb.querySelector(".img-remove").addEventListener("click", () => {
      stateArr.splice(i, 1);
      renderImageStrip(containerId, stateArr, stateArr, maxImages);
    });

    thumb.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", String(i));
    });
    thumb.addEventListener("dragover", (e) => { e.preventDefault(); });
    thumb.addEventListener("drop", (e) => {
      e.preventDefault();
      const from = parseInt(e.dataTransfer.getData("text/plain"));
      const to   = i;
      if (from === to) return;
      const [moved] = stateArr.splice(from, 1);
      stateArr.splice(to, 0, moved);
      renderImageStrip(containerId, stateArr, stateArr, maxImages);
    });

    container.appendChild(thumb);
  });
}

/**
 * Show (or refresh) a gallery of product images the user can click to add to the strip.
 *
 * @param {string}   pickerId  - ID of the gallery container element
 * @param {string}   stripId   - ID of the image strip container element
 * @param {string[]} stateArr  - Live mutable image URL array
 * @param {object}   product   - Product row (used by buildImageUrls)
 * @param {number}   [maxImages] - Max images allowed (default 24)
 * @param {object}   [options]
 * @param {boolean}  [options.showAll=false] - List every available image, not just unused
 * @param {(product: object) => string[]} [options.buildAvailableUrls=buildImageUrls]
 */
export function showGalleryPicker(pickerId, stripId, stateArr, product, maxImages = 24, options = {}) {
  const {
    showAll = false,
    buildAvailableUrls = buildImageUrls,
  } = options;
  const picker = document.getElementById(pickerId);
  const allAvailable = buildAvailableUrls(product);
  const displayUrls = showAll
    ? allAvailable
    : allAvailable.filter((url) => !stateArr.includes(url));

  if (!displayUrls.length) {
    picker.innerHTML = '<span class="text-[10px] text-gray-400">No images available</span>';
    picker.classList.remove("hidden");
    return;
  }

  picker.innerHTML = "";
  displayUrls.forEach((url) => {
    const selected = stateArr.includes(url);
    const thumb = document.createElement("div");
    thumb.className = "img-thumb picker" + (selected ? " selected" : "");
    thumb.innerHTML = `<img src="${esc(url)}" alt="add" />`;
    thumb.addEventListener("click", () => {
      if (selected || stateArr.length >= maxImages) return;
      stateArr.push(url);
      renderImageStrip(stripId, stateArr, stateArr, maxImages);
      showGalleryPicker(pickerId, stripId, stateArr, product, maxImages, options);
    });
    picker.appendChild(thumb);
  });

  picker.classList.remove("hidden");
}
