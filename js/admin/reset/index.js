import { initNavbar } from "/js/shared/navbar.js";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "/js/config/env.js";

/* =========================
   CONFIG
========================= */
const DEBUG = false; // ← set true only when debugging

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* =========================
   ELEMENTS
========================= */
const statusEl = document.getElementById("status");
const debugBox = document.getElementById("debugBox");
const debugEl = document.getElementById("debug");
const form = document.getElementById("form");

/* =========================
   HELPERS
========================= */
function setStatus(msg) {
  if (statusEl) statusEl.textContent = msg;
}

function showDebug(data) {
  if (!DEBUG || !debugBox || !debugEl) return;
  debugBox.classList.remove("hidden");
  debugEl.textContent =
    typeof data === "string" ? data : JSON.stringify(data, null, 2);
}

/* =========================
   SESSION HANDLING
========================= */
async function ensureSessionFromUrlIfPresent() {
  const hashParams = new URLSearchParams(window.location.hash.replace("#", ""));
  const searchParams = new URLSearchParams(window.location.search);

  const code = searchParams.get("code");
  const accessToken = hashParams.get("access_token");

  // Nothing in URL — fine if auth-callback already ran
  if (!code && !accessToken) return false;

  // PKCE flow (?code=...)
  if (code) {
    setStatus("Verifying reset link…");
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
    return true;
  }

  // Implicit flow (#access_token=...)
  // supabase-js reads this automatically
  return true;
}

/* =========================
   INIT
========================= */
async function init() {
  try {
    // ✅ Navbar injection + drawer/cart wiring
    // (safe on admin pages; cart UI will be hidden via body.kk-admin CSS)
    try {
      await initNavbar();
    } catch (navErr) {
      console.warn("[Reset] Navbar init failed (non-blocking):", navErr);
    }

    setStatus("Checking session…");

    showDebug({
      href: window.location.href,
      search: window.location.search,
      hash: window.location.hash,
    });

    // 1) If auth-callback already stored session
    let { data: { session } } = await supabase.auth.getSession();
    if (session) {
      setStatus("Session loaded. Enter a new password.");
      form?.classList.remove("hidden");
      return;
    }

    // 2) Otherwise, try URL-based recovery
    await ensureSessionFromUrlIfPresent();

    // 3) Re-check session
    ({ data: { session } } = await supabase.auth.getSession());

    if (!session) {
      setStatus("Invalid or expired reset link.");
      return;
    }

    setStatus("Session loaded. Enter a new password.");
    form?.classList.remove("hidden");

  } catch (err) {
    setStatus("Error loading reset session.");
    showDebug({ error: err?.message || err });
  }
}

/* =========================
   FORM SUBMIT
========================= */
form?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const pw1 = document.getElementById("pw1")?.value.trim();
  const pw2 = document.getElementById("pw2")?.value.trim();

  if (!pw1 || pw1.length < 8) {
    setStatus("Password must be at least 8 characters.");
    return;
  }

  if (pw1 !== pw2) {
    setStatus("Passwords do not match.");
    return;
  }

  setStatus("Updating password…");

  const { error } = await supabase.auth.updateUser({ password: pw1 });

  if (error) {
    setStatus("Password update failed.");
    showDebug({ step: "updateUser", error });
    return;
  }

  setStatus("Password updated. You can close this page.");
  form.reset();
});

/* =========================
   START
========================= */
init();
