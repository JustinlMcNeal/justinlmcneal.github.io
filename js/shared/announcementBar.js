// /js/shared/announcementBar.js
// Renders the announcement bar at the top of the page

import { getSupabaseClient } from "./supabaseClient.js";

const STORAGE_KEY = "kk_announcement_dismissed";

export async function initAnnouncementBar() {
  // Check if already dismissed in this session
  if (sessionStorage.getItem(STORAGE_KEY)) return;

  const supabase = getSupabaseClient();
  
  try {
    const { data } = await supabase
      .from("site_settings")
      .select("value")
      .eq("key", "announcement_bar")
      .single();

    if (!data?.value?.enabled) return;

    const { text, link, bg_color, text_color, show_close } = data.value;
    if (!text) return;

    renderBar({ text, link, bg_color, text_color, show_close });
  } catch (err) {
    // Silently fail - don't block page load
    console.warn("[AnnouncementBar] Failed to load:", err.message);
  }
}

function renderBar({ text, link, bg_color, text_color, show_close }) {
  // Remove existing bar if any
  const existing = document.getElementById("kkAnnouncementBar");
  if (existing) existing.remove();

  // Create bar element
  const bar = document.createElement("div");
  bar.id = "kkAnnouncementBar";
  bar.className = "fixed top-0 left-0 right-0 z-[100] transition-transform duration-300";
  bar.style.background = bg_color || "#000";
  bar.style.color = text_color || "#fff";

  const inner = document.createElement("div");
  inner.className = "flex items-center justify-center gap-4 py-2.5 px-4 text-center text-sm font-bold";

  // Text/Link content
  if (link) {
    const a = document.createElement("a");
    a.href = link;
    a.className = "underline underline-offset-2 hover:no-underline";
    a.textContent = text;
    inner.appendChild(a);
  } else {
    const span = document.createElement("span");
    span.textContent = text;
    inner.appendChild(span);
  }

  // Close button
  if (show_close) {
    const closeBtn = document.createElement("button");
    closeBtn.className = "absolute right-3 top-1/2 -translate-y-1/2 opacity-60 hover:opacity-100 text-lg leading-none p-1";
    closeBtn.innerHTML = "✕";
    closeBtn.setAttribute("aria-label", "Dismiss announcement");
    closeBtn.addEventListener("click", () => {
      bar.style.transform = "translateY(-100%)";
      sessionStorage.setItem(STORAGE_KEY, "1");
      
      // Adjust page padding
      setTimeout(() => {
        bar.remove();
        adjustPagePadding(false);
      }, 300);
    });
    inner.appendChild(closeBtn);
    inner.classList.add("relative");
  }

  bar.appendChild(inner);

  // Insert at very top of body
  document.body.insertBefore(bar, document.body.firstChild);

  // Adjust page padding to account for bar
  adjustPagePadding(true);
}

function adjustPagePadding(hasBar) {
  // Find the navbar spacer (h-[76px] div at top)
  const spacer = document.querySelector("[data-kk-nav] ~ .h-\\[76px\\], .h-\\[76px\\]:first-child");
  
  // Or adjust the nav itself
  const nav = document.querySelector("[data-kk-nav]");
  
  if (hasBar) {
    // Move nav down by bar height (~40px)
    if (nav) nav.style.top = "40px";
    // Add extra padding at top
    document.body.style.paddingTop = "40px";
  } else {
    if (nav) nav.style.top = "0";
    document.body.style.paddingTop = "0";
  }
}
