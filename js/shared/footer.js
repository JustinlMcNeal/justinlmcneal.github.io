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

    const { data } = await sb.auth.getSession();
    const session = data?.session;

    if (session) {
      // Show admin-only elements in footer
      document.querySelectorAll('#kkFooterMount .kk-admin-only').forEach(el => {
        el.classList.remove('hidden');
      });
    }
  } catch (err) {
    console.error('[footer] Error checking admin status:', err);
  }
}
