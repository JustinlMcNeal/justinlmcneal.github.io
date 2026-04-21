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
 */
export function renderImageStrip(containerId, urls, stateArr) {
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
      renderImageStrip(containerId, stateArr, stateArr);
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
      renderImageStrip(containerId, stateArr, stateArr);
    });

    container.appendChild(thumb);
  });
}

/**
 * Show (or refresh) a gallery of unused product images the user can click
 * to add to the image strip.
 *
 * @param {string}   pickerId  - ID of the gallery container element
 * @param {string}   stripId   - ID of the image strip container element
 * @param {string[]} stateArr  - Live mutable image URL array
 * @param {object}   product   - Product row (used by buildImageUrls)
 */
export function showGalleryPicker(pickerId, stripId, stateArr, product) {
  const picker       = document.getElementById(pickerId);
  const allAvailable = buildImageUrls(product);
  const unused       = allAvailable.filter(url => !stateArr.includes(url));

  if (!unused.length) {
    picker.innerHTML = '<span class="text-[10px] text-gray-400">No additional images available</span>';
    picker.classList.remove("hidden");
    return;
  }

  picker.innerHTML = "";
  unused.forEach(url => {
    const thumb = document.createElement("div");
    thumb.className = "img-thumb picker";
    thumb.innerHTML = `<img src="${esc(url)}" alt="add" />`;
    thumb.addEventListener("click", () => {
      if (stateArr.length >= 24) return;
      stateArr.push(url);
      renderImageStrip(stripId, stateArr, stateArr);
      showGalleryPicker(pickerId, stripId, stateArr, product);
    });
    picker.appendChild(thumb);
  });

  picker.classList.remove("hidden");
}
