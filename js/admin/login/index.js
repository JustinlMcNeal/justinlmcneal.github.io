// /js/admin/login/index.js
import { initNavbar } from "/js/shared/navbar.js";
import { getSupabaseClient } from "/js/shared/supabaseClient.js";

function qs(name) {
  return new URLSearchParams(location.search).get(name);
}

function nextUrl() {
  const fallback = "/pages/admin/index.html";
  const next = qs("next");
  return next && next.startsWith("/") ? next : fallback;
}

function setText(el, txt) {
  if (el) el.textContent = txt ?? "";
}

function showStatus(els, msg, isError = false) {
  if (!els.statusBox) return;
  els.statusBox.classList.remove("hidden");
  setText(els.statusKicker, isError ? "Error" : "Status");
  setText(els.statusMsg, msg);
  if (els.statusMsg) {
    els.statusMsg.className =
      "text-sm mt-2 " + (isError ? "text-red-700" : "text-black/70");
  }
}

function setBusy(els, yes) {
  if (els.loginBtn) {
    els.loginBtn.disabled = !!yes;
    els.loginBtn.textContent = yes ? "Signing in…" : "Sign in";
  }
  if (els.magicBtn) els.magicBtn.disabled = !!yes;
  if (els.email) els.email.disabled = !!yes;
  if (els.password) els.password.disabled = !!yes;
}

async function boot() {
  // ✅ Ensure navbar is injected + drawer logic initialized on this page too
  // (Safe even if the page doesn't use drawers)
  try {
    await initNavbar();
  } catch (e) {
    console.warn("[login] initNavbar failed (non-fatal):", e);
  }

  const els = {
    form: document.getElementById("loginForm"),
    email: document.getElementById("email"),
    password: document.getElementById("password"),
    loginBtn: document.getElementById("loginBtn"),
    magicBtn: document.getElementById("magicBtn"),

    statusBox: document.getElementById("statusBox"),
    statusKicker: document.getElementById("statusKicker"),
    statusMsg: document.getElementById("statusMsg"),

    alreadyIn: document.getElementById("alreadyIn"),
    alreadyEmail: document.getElementById("alreadyEmail"),
    goNextBtn: document.getElementById("goNextBtn"),
    logoutBtn: document.getElementById("logoutBtn"),
  };

  if (!els.form) {
    console.error("[login] loginForm not found");
    return;
  }

  const sb = getSupabaseClient();
  if (!sb) {
    showStatus(
      els,
      "Supabase client is not initialized. Check /js/shared/supabaseClient.js and env keys.",
      true
    );
    setBusy(els, true);
    return;
  }

  // show "already logged in"
  try {
    const { data, error } = await sb.auth.getSession();
    if (error) console.warn("[login] getSession error:", error);

    const session = data?.session;
    if (session?.user) {
      els.form.classList.add("hidden");
      els.alreadyIn?.classList.remove("hidden");
      setText(els.alreadyEmail, session.user.email || "");
      if (els.goNextBtn) els.goNextBtn.href = nextUrl();
    }
  } catch (e) {
    console.error("[login] getSession failed:", e);
  }

  // password login
  els.form.addEventListener("submit", async (e) => {
    e.preventDefault();
    setBusy(els, true);

    try {
      const email = (els.email?.value || "").trim();
      const password = els.password?.value || "";

      if (!email || !password) {
        showStatus(els, "Enter email + password.", true);
        return;
      }

      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;

      location.href = nextUrl();
    } catch (err) {
      console.error("[login] signInWithPassword error:", err);
      showStatus(els, err?.message || "Login failed.", true);
    } finally {
      setBusy(els, false);
    }
  });

  // magic link
  els.magicBtn?.addEventListener("click", async () => {
    const email = (els.email?.value || "").trim();
    if (!email) return showStatus(els, "Enter your email first.", true);

    setBusy(els, true);
    try {
      const redirectTo = `${location.origin}${nextUrl()}`;
      const { error } = await sb.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectTo },
      });
      if (error) throw error;
      showStatus(els, "Magic link sent. Check your email.");
    } catch (err) {
      console.error("[login] signInWithOtp error:", err);
      showStatus(els, err?.message || "Magic link failed.", true);
    } finally {
      setBusy(els, false);
    }
  });

  // logout (already-in screen)
  els.logoutBtn?.addEventListener("click", async () => {
    try {
      await sb.auth.signOut();
    } catch (e) {
      console.error("[login] signOut error:", e);
    }
    location.href = "/pages/admin/login.html";
  });
}

document.addEventListener("DOMContentLoaded", boot);
