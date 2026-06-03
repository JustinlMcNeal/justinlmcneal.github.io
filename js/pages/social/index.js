import { initFooter } from "/js/shared/footer.js";
import { initNavbar } from "/js/shared/navbar.js";
import { PUBLIC_SOCIAL_PLATFORMS } from "/js/shared/socialLinks.js";

const PLATFORM_ICONS = {
  instagram: `<svg class="w-7 h-7" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>`,
  tiktok: `<svg class="w-7 h-7" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-5.2 1.74 2.89 2.89 0 012.31-4.64 2.93 2.93 0 01.88.13V9.4a6.84 6.84 0 00-1-.05A6.33 6.33 0 005 20.1a6.34 6.34 0 0010.86-4.43v-7a8.16 8.16 0 004.77 1.52v-3.4a4.85 4.85 0 01-1-.1z"/></svg>`,
  pinterest: `<svg class="w-7 h-7" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 0C5.373 0 0 5.373 0 12c0 5.084 3.163 9.426 7.627 11.174-.105-.949-.2-2.406.042-3.442.218-.936 1.407-5.965 1.407-5.965s-.359-.719-.359-1.781c0-1.669.967-2.914 2.171-2.914 1.024 0 1.518.769 1.518 1.69 0 1.03-.655 2.569-.994 3.995-.283 1.195.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.208 0 1.031.397 2.137.893 2.739.098.119.112.223.083.344-.091.378-.293 1.194-.333 1.361-.052.218-.173.265-.4.16-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.966 7.398 6.931 0 4.136-2.608 7.464-6.227 7.464-1.216 0-2.359-.632-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0z"/></svg>`,
};

function renderPlatformCard(platform) {
  const icon = PLATFORM_ICONS[platform.id] || "";
  const primaryClass = platform.primary ? "kk-social-card--primary" : "";
  const badge = platform.primary
    ? `<span class="kk-social-badge">Primary</span>`
    : "";

  return `
    <a
      href="${platform.url}"
      target="_blank"
      rel="noopener noreferrer"
      class="kk-social-card ${primaryClass} group flex flex-col sm:flex-row sm:items-center gap-4 bg-white rounded-2xl border-2 border-gray-200 p-5 sm:p-6 hover:border-black transition-colors"
      aria-label="${platform.cta}"
    >
      <span class="flex items-center gap-4 flex-1 min-w-0">
        <span class="kk-social-icon flex-shrink-0 w-14 h-14 rounded-full border-2 border-black flex items-center justify-center bg-gray-50 group-hover:bg-black group-hover:text-white transition-colors">
          ${icon}
        </span>
        <span class="min-w-0">
          <span class="flex flex-wrap items-center gap-2 mb-1">
            <span class="font-black text-lg uppercase tracking-wide">${platform.name}</span>
            ${badge}
          </span>
          <span class="block text-gray-500 text-sm">${platform.handle}</span>
        </span>
      </span>
      <span class="inline-flex items-center justify-center flex-shrink-0 bg-black text-white font-bold text-sm uppercase tracking-wider px-5 py-3 rounded-xl group-hover:bg-kkpink transition-colors">
        ${platform.cta}
      </span>
    </a>
  `;
}

function renderSocialPlatforms() {
  const mount = document.getElementById("kkSocialPlatforms");
  if (!mount) return;

  const sorted = [...PUBLIC_SOCIAL_PLATFORMS].sort((a, b) => {
    if (a.primary === b.primary) return 0;
    return a.primary ? -1 : 1;
  });

  mount.innerHTML = sorted.map(renderPlatformCard).join("");
  mount.setAttribute("aria-busy", "false");
}

async function initSocialPage() {
  await initNavbar();
  await initFooter();
}

renderSocialPlatforms();

document.addEventListener("DOMContentLoaded", () => {
  initSocialPage();
});
