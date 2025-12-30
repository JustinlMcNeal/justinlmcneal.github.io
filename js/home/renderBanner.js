// /js/home/renderBanner.js

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function isVideoPath(path) {
  const p = String(path || "").trim().toLowerCase();
  return p.endsWith(".mp4") || p.endsWith(".webm") || p.endsWith(".ogg");
}

function showEl(el, yes) {
  if (!el) return;
  el.classList.toggle("is-hidden", !yes);
}

/**
 * promo object fields used:
 * - banner_title
 * - banner_subtitle
 * - banner_image_path  (can be image OR video path)
 * - name / description (fallbacks)
 */
export function renderHomeBanner(promo) {
  const titleEl = document.getElementById("promoTitle");
  const subEl = document.getElementById("promoSubtitle");
  const kickerEl = document.getElementById("promoKicker");

  // We are removing promo badge support completely
  const badgesEl = document.getElementById("promoBadges");
  if (badgesEl) badgesEl.innerHTML = "";

  const imgEl = document.getElementById("promoBannerImg");
  const vidEl = document.getElementById("promoBannerVideo");

  if (!titleEl || !subEl || !kickerEl) return;

  // -----------------------------
  // NO PROMO (fallback state)
  // -----------------------------
  if (!promo) {
    kickerEl.textContent = "Welcome";
    titleEl.innerHTML = "Featured Drop";
    subEl.textContent =
      "New deals rotate based on what’s live — check back for fresh promos.";

    // hide media
    if (imgEl) {
      imgEl.src = "";
      imgEl.alt = "";
      showEl(imgEl, false);
    }
    if (vidEl) {
      // stop + unload video
      try { vidEl.pause(); } catch {}
      vidEl.removeAttribute("src");
      vidEl.load();
      showEl(vidEl, false);
    }

    return;
  }

  // -----------------------------
  // TEXT CONTENT
  // -----------------------------
  kickerEl.textContent = "Promotion";

  titleEl.innerHTML = esc(
    promo.banner_title ||
    promo.name ||
    "Promotion"
  );

  subEl.textContent = String(
    promo.banner_subtitle ||
    promo.description ||
    ""
  );

  // -----------------------------
  // MEDIA (IMAGE or VIDEO)
  // -----------------------------
  const rawPath = String(promo.banner_image_path || "").trim();

  // Nothing set
  if (!rawPath) {
    if (imgEl) {
      imgEl.src = "";
      imgEl.alt = "";
      showEl(imgEl, false);
    }
    if (vidEl) {
      try { vidEl.pause(); } catch {}
      vidEl.removeAttribute("src");
      vidEl.load();
      showEl(vidEl, false);
    }
    return;
  }

  const useVideo = isVideoPath(rawPath);

  if (useVideo) {
    // Show video
    if (imgEl) {
      imgEl.src = "";
      imgEl.alt = "";
      showEl(imgEl, false);
    }

    if (vidEl) {
      // Set src only if changed (prevents restart flicker)
      const current = (vidEl.getAttribute("src") || "").trim();
      if (current !== rawPath) {
        vidEl.setAttribute("src", rawPath);
        vidEl.load();
      }

      showEl(vidEl, true);

      // Try to play (autoplay should work because muted + playsinline)
      const playPromise = vidEl.play?.();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(() => {
          // If autoplay is blocked for some reason, we still show the first frame
          // (video stays visible)
        });
      }
    }
  } else {
    // Show image
    if (vidEl) {
      try { vidEl.pause(); } catch {}
      vidEl.removeAttribute("src");
      vidEl.load();
      showEl(vidEl, false);
    }

    if (imgEl) {
      imgEl.src = rawPath;
      imgEl.alt = promo.banner_title || promo.name || "Promotion banner";
      showEl(imgEl, true);
    }
  }
}
