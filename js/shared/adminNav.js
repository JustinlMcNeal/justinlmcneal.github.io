/**
 * @file adminNav.js – Karry Kraze Admin Navigation Loader
 * Loads the admin nav bar and handles logout
 */

import { getSupabaseClient } from "./supabaseClient.js";

const ADMIN_NAV_PATH = '/page_inserts/admin-nav.html';

/**
 * Initialize the admin navigation bar
 * @param {string} pageTitle - The title to display for the current page
 */
export async function initAdminNav(pageTitle = '') {
  const mount = document.getElementById('kkAdminNavMount');
  if (!mount) {
    console.warn('[adminNav] No #kkAdminNavMount found on page');
    return;
  }

  try {
    const res = await fetch(ADMIN_NAV_PATH);
    if (!res.ok) throw new Error(`Failed to load admin nav: ${res.status}`);
    
    const html = await res.text();
    mount.innerHTML = html;

    // Set page title
    const titleEl = document.getElementById('adminPageTitle');
    if (titleEl && pageTitle) {
      titleEl.textContent = pageTitle;
    }

    // Wire up mobile menu toggle
    wireMenuToggle();

    // Wire up logout buttons
    wireLogout();

    // Highlight current page link
    highlightCurrentPage();

  } catch (err) {
    console.error('[adminNav] Error loading admin nav:', err);
  }
}

/**
 * Wire up mobile menu toggle
 */
function wireMenuToggle() {
  const toggle = document.getElementById('adminMenuToggle');
  const menu = document.getElementById('adminMobileMenu');
  
  if (toggle && menu) {
    toggle.addEventListener('click', () => {
      menu.classList.toggle('hidden');
      // Rotate hamburger to X
      const isOpen = !menu.classList.contains('hidden');
      toggle.innerHTML = isOpen 
        ? `<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>`
        : `<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16"/></svg>`;
    });
  }
}

/**
 * Wire up logout buttons
 */
function wireLogout() {
  const logoutBtns = document.querySelectorAll('#btnAdminLogout, #btnAdminLogoutMobile');
  
  logoutBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        const sb = getSupabaseClient();
        if (sb) {
          await sb.auth.signOut();
        }
        window.location.href = '/pages/admin/login.html';
      } catch (err) {
        console.error('[adminNav] Logout error:', err);
        window.location.href = '/pages/admin/login.html';
      }
    });
  });
}

/**
 * Highlight the current page in the nav
 */
function highlightCurrentPage() {
  const currentPath = window.location.pathname;
  const navLinks = document.querySelectorAll('#kkAdminNavMount nav a');
  
  navLinks.forEach(link => {
    const href = link.getAttribute('href');
    if (href && currentPath.endsWith(href.replace(/^\//, ''))) {
      link.classList.remove('text-white/60', 'text-white/80');
      link.classList.add('text-white', 'font-bold');
    }
  });
}
