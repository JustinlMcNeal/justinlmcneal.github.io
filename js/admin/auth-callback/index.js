import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "/js/config/env.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const statusEl = document.getElementById("status");
const debugBox = document.getElementById("debugBox");
const debugEl = document.getElementById("debug");

function showDebug(obj) {
  debugBox.classList.remove("hidden");
  debugEl.textContent = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
}

function getUrlParts() {
  const searchParams = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(window.location.hash.replace("#", ""));
  return { searchParams, hashParams };
}

async function init() {
  try {
    statusEl.textContent = "Reading auth link…";

    showDebug({
      href: window.location.href,
      search: window.location.search,
      hash: window.location.hash
    });

    const { searchParams, hashParams } = getUrlParts();
    const code = searchParams.get("code");
    const type = hashParams.get("type") || searchParams.get("type");

    // 1) PKCE links (?code=...)
    if (code) {
      statusEl.textContent = "Exchanging code for session…";
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) throw error;
    }

    // 2) Hash-token links (#access_token=...) — session should be readable after page load
    // We don’t need to manually setSession here unless you want to.
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
      statusEl.textContent = "No session created. Link may be expired.";
      return;
    }

    // Clear URL junk (optional)
    history.replaceState({}, "", window.location.pathname);

    // Decide destination:
    // If this was a recovery link, go to reset page.
    // Otherwise you can route to an admin home/dashboard page if you want.
    const dest = (type === "recovery")
      ? "/pages/admin/reset.html"
      : "/pages/admin/index.html"; 

    statusEl.textContent = "Session created. Redirecting…";
    window.location.replace(dest);
  } catch (err) {
    statusEl.textContent = "Auth callback error.";
    showDebug({ message: String(err?.message || err), err });
  }
}

init();
