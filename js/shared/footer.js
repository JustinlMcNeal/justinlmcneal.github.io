/**
 * @file footer.js  –  Karry Kraze Footer Loader
 * Dynamically loads the footer HTML into the page
 */

import { getSupabaseClient } from "./supabaseClient.js";

const FOOTER_HTML_PATH = '/page_inserts/footer.html';

/**
 * Initialize the footer by loading HTML into the mount point
 */
export async function initFooter() {
  const mount = document.getElementById('kkFooterMount');
  if (!mount) {
    console.warn('[footer] No #kkFooterMount found on page');
    return;
  }

  try {
    const res = await fetch(FOOTER_HTML_PATH);
    if (!res.ok) throw new Error(`Failed to load footer: ${res.status}`);
    
    const html = await res.text();
    mount.innerHTML = html;
    
    // Update copyright year dynamically
    updateCopyrightYear();
    
    // Show admin-only links if user is admin
    await applyAdminFooterBehavior();

    // Secret admin access: tap footer logo 5 times quickly
    initSecretAdminTap();
    
  } catch (err) {
    console.error('[footer] Error loading footer:', err);
  }
}

/**
 * Updates the copyright year to current year
 */
function updateCopyrightYear() {
  const footer = document.querySelector('#kkFooterMount footer');
  if (!footer) return;
  
  const currentYear = new Date().getFullYear();
  const copyrightEl = footer.querySelector('p');
  if (copyrightEl && copyrightEl.textContent.includes('©')) {
    copyrightEl.innerHTML = copyrightEl.innerHTML.replace(/\d{4}/, currentYear);
  }
}

/**
 * Show admin-only links in footer if user is logged in as admin
 */
async function applyAdminFooterBehavior() {
  try {
    const sb = getSupabaseClient();
    if (!sb) return;

    const { data: sessionData } = await sb.auth.getSession();
    if (!sessionData?.session) return;

    const { data: isAdmin } = await sb.rpc('is_admin');
    if (isAdmin) {
      document.querySelectorAll('#kkFooterMount .kk-admin-only').forEach(el => {
        el.classList.remove('hidden');
      });
    }
  } catch (err) {
    console.error('[footer] Error checking admin status:', err);
  }
}

/**
 * Secret admin tap: tap footer logo 5 times within 3 seconds to go to admin login
 */
function initSecretAdminTap() {
  const logo = document.getElementById('kkFooterLogo');
  if (!logo) return;

  let tapCount = 0;
  let tapTimer = null;

  logo.addEventListener('click', (e) => {
    tapCount++;
    if (tapCount === 1) {
      tapTimer = setTimeout(() => { tapCount = 0; }, 3000);
    }
    if (tapCount >= 5) {
      e.preventDefault();
      clearTimeout(tapTimer);
      tapCount = 0;
      window.location.href = '/pages/admin/login.html';
    }
  });
}
