import { qs, qsa, show, hide } from "./dom.js";
import {
  disconnectAmazon,
  getAmazonAuthStatus,
  importAmazonSelfAuthToken,
  startAmazonAuth,
} from "./api.js";
import { hideAmazonNotification, showAmazonNotification } from "./notifications.js";

const MARKETPLACE_LABELS = {
  ATVPDKIKX0DER: "US · Amazon.com",
};

const AUTH_ERROR_MESSAGES = {
  user_denied: "Amazon authorization was cancelled.",
  invalid_state: "Authorization session expired. Please try again.",
  state_already_used: "Authorization link was already used. Please reconnect.",
  state_expired: "Authorization session expired. Please reconnect.",
  token_exchange_failed: "Could not complete Amazon authorization.",
  missing_seller_id: "Amazon did not return seller information.",
  vault_write_failed: "Connected to Amazon but token storage failed.",
  db_write_failed: "Could not save Amazon connection.",
  server_misconfigured: "Amazon integration is not configured yet.",
  missing_code: "Amazon authorization did not return a code.",
};

/** @type {Record<string, unknown> | null} */
let authState = null;

function formatDate(value) {
  if (!value) return "Never";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "Never";
  return date.toLocaleString();
}

function marketplaceLabel(ids) {
  const list = Array.isArray(ids) ? ids : [];
  if (list.length === 0) return "—";
  return MARKETPLACE_LABELS[list[0]] || list[0];
}

function setPanelState(state) {
  const panel = qs("#amazonAuthPanel");
  if (panel) panel.dataset.authState = state;

  const sections = {
    loading: qs("#amazonAuthPanelLoading"),
    connected: qs("#amazonAuthPanelConnected"),
    disconnected: qs("#amazonAuthPanelDisconnected"),
    error: qs("#amazonAuthPanelError"),
    revoked: qs("#amazonAuthPanelRevoked"),
  };

  for (const [key, el] of Object.entries(sections)) {
    if (!el) continue;
    if (key === state) show(el);
    else hide(el);
  }
}

function setSyncButtonsEnabled(enabled) {
  qsa('[data-action="sync-amazon"]').forEach((btn) => {
    btn.disabled = !enabled;
    btn.setAttribute("data-auth-disabled", enabled ? "false" : "true");
    btn.setAttribute("aria-disabled", enabled ? "false" : "true");
    btn.classList.toggle("opacity-60", !enabled);
    btn.classList.toggle("cursor-not-allowed", !enabled);
    if (enabled) {
      btn.removeAttribute("title");
    } else {
      btn.title = "Connect Amazon before syncing";
    }
  });
}

function renderConnected(status) {
  setPanelState("connected");
  setSyncButtonsEnabled(true);

  const seller = qs("#amazonAuthSellerId");
  const marketplace = qs("#amazonAuthMarketplace");
  const refresh = qs("#amazonAuthLastRefresh");

  if (seller) seller.textContent = String(status.sellerId || "Connected");
  if (marketplace) {
    marketplace.textContent = marketplaceLabel(status.marketplaceIds);
  }
  if (refresh) {
    refresh.textContent = formatDate(status.lastTokenRefreshAt);
  }
}

const SELF_IMPORT_HTML = `
  <div id="amazonAuthSelfImport" class="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
    <p class="text-xs font-black uppercase tracking-[.12em] text-gray-700">Private app: import SPP refresh token</p>
    <p class="text-xs text-gray-500 mt-2">SPP → Karry Kraze → Authorize → copy seller ID and refresh token, then paste below.</p>
    <div class="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
      <label class="block text-xs font-medium text-gray-600">
        Seller ID
        <input type="text" id="amazonSelfAuthSellerId" autocomplete="off" placeholder="A1XXXXXXXXXXXXX" class="mt-1 w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm font-mono">
      </label>
      <label class="block text-xs font-medium text-gray-600 sm:col-span-2">
        Refresh token (from SPP Authorize)
        <input type="password" id="amazonSelfAuthRefreshToken" autocomplete="off" placeholder="Atzr|…" class="mt-1 w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm font-mono">
      </label>
    </div>
    <button type="button" data-action="import-self-auth" class="mt-3 inline-flex items-center justify-center border-2 border-black bg-white text-black px-4 py-2 text-[10px] font-black uppercase tracking-[.12em] min-h-[40px] hover:bg-gray-100">Save token</button>
  </div>`;

function ensureSelfImportUi() {
  if (qs("#amazonAuthSelfImport")) return;
  const panel = qs("#amazonAuthPanelDisconnected");
  if (!panel) return;
  panel.insertAdjacentHTML("beforeend", SELF_IMPORT_HTML);
}

function renderDisconnected(detail) {
  setPanelState("disconnected");
  setSyncButtonsEnabled(false);
  ensureSelfImportUi();

  const detailEl = qs("#amazonAuthDisconnectedDetail");
  if (detailEl) {
    detailEl.textContent = detail ||
      "Use the SPP refresh token form below (private apps). Connect Amazon is for public apps and may return MD1000.";
  }
}

function renderRevoked(status) {
  setPanelState("revoked");
  setSyncButtonsEnabled(false);

  const seller = qs("#amazonAuthRevokedSellerId");
  if (seller) seller.textContent = String(status?.sellerId || "—");
}

function renderError() {
  setPanelState("error");
  setSyncButtonsEnabled(false);
}

export function getAuthState() {
  return authState;
}

export function isAmazonConnected() {
  return Boolean(authState?.connected && authState?.tokenStatus === "active");
}

export async function refreshAmazonAuthStatus() {
  setPanelState("loading");
  try {
    const status = await getAmazonAuthStatus();
    authState = status;

    if (status.connected && status.tokenStatus === "active") {
      renderConnected(status);
      return status;
    }

    if (
      status.tokenStatus === "revoked" ||
      status.tokenStatus === "expired" ||
      status.tokenStatus === "error"
    ) {
      renderRevoked(status);
      return status;
    }

    renderDisconnected();
    return status;
  } catch (err) {
    authState = {
      connected: false,
      tokenStatus: "not_connected",
    };

    const code = err?.code || "request_failed";
    if (code === "unauthorized" || code === "forbidden") {
      renderError();
      showAmazonNotification("Please sign in as an admin to manage Amazon.", {
        tone: "error",
      });
      throw err;
    }

    if (code === "timeout" || code === "auth_timeout" || code === "network_error" || code === "status_unavailable") {
      renderDisconnected(
        code === "status_unavailable"
          ? "Amazon status service is not available yet (edge function may need deploy). Sync and Connect are disabled until then. You can still use filters, table settings, and export on cached listings."
          : "Could not reach Amazon status service. Sync and Connect are disabled for now. You can still browse cached listing data and adjust table settings.",
      );
      return authState;
    }

    renderError();
    showAmazonNotification("Could not load Amazon connection status.", {
      tone: "error",
    });
    throw err;
  }
}

function cleanAuthQueryParams() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("amazon_auth")) return;
  url.searchParams.delete("amazon_auth");
  url.searchParams.delete("reason");
  window.history.replaceState({}, document.title, url.pathname + url.search);
}

function handleAuthRedirectParams() {
  const params = new URLSearchParams(window.location.search);
  const outcome = params.get("amazon_auth");
  if (!outcome) return;

  if (outcome === "success") {
    showAmazonNotification("Amazon connected successfully.", { tone: "success" });
  } else if (outcome === "error") {
    const reason = params.get("reason") || "unknown";
    const message = AUTH_ERROR_MESSAGES[reason] ||
      "Amazon authorization failed. Please try again.";
    showAmazonNotification(message, { tone: "error" });
  }

  cleanAuthQueryParams();
}

async function handleConnectClick(button) {
  if (button.disabled) return;
  button.disabled = true;
  try {
    const data = await startAmazonAuth({
      redirectAfter: "/pages/admin/amazon.html",
    });
    if (data.redirectUrl) {
      window.location.href = data.redirectUrl;
      return;
    }
    showAmazonNotification("Could not start Amazon authorization.", { tone: "error" });
  } catch (err) {
    const code = err?.code || "request_failed";
    showAmazonNotification(
      code === "unauthorized"
        ? "Please sign in as an admin to connect Amazon."
        : code === "invalid_request"
          ? "Amazon connect misconfigured (marketplace or redirect). Check Supabase Amazon secrets and DB marketplaces."
          : "Could not start Amazon authorization.",
      { tone: "error" },
    );
  } finally {
    button.disabled = false;
  }
}

async function handleImportSelfAuthClick(button) {
  if (button.disabled) return;

  const sellerIdEl = qs("#amazonSelfAuthSellerId");
  const tokenEl = qs("#amazonSelfAuthRefreshToken");
  const sellerId = sellerIdEl instanceof HTMLInputElement ? sellerIdEl.value.trim() : "";
  const refreshToken = tokenEl instanceof HTMLInputElement ? tokenEl.value.trim() : "";

  if (!sellerId || !refreshToken) {
    showAmazonNotification("Enter seller ID and refresh token from SPP Authorize.", { tone: "error" });
    return;
  }

  button.disabled = true;
  try {
    await importAmazonSelfAuthToken({ sellerId, refreshToken });
    if (tokenEl instanceof HTMLInputElement) tokenEl.value = "";
    showAmazonNotification("Amazon connected via SPP self-authorization.", { tone: "success" });
    await refreshAmazonAuthStatus();
  } catch (err) {
    const code = err?.code || "request_failed";
    const hint = err?.hint || "";
    showAmazonNotification(
      code === "invalid_refresh_token"
        ? (hint || "Refresh token rejected by Amazon. Check LWA client ID/secret in Supabase match SPP → View LWA credentials.")
        : code === "unauthorized"
          ? "Please sign in as an admin."
          : "Could not save Amazon token.",
      { tone: "error" },
    );
  } finally {
    button.disabled = false;
  }
}

async function handleDisconnectClick(button) {
  if (button.disabled) return;
  if (!window.confirm("Disconnect Amazon? Listing history will remain in Karry Kraze.")) {
    return;
  }

  button.disabled = true;
  try {
    await disconnectAmazon();
    showAmazonNotification("Amazon disconnected.", { tone: "success" });
    await refreshAmazonAuthStatus();
  } catch {
    showAmazonNotification("Could not disconnect Amazon.", { tone: "error" });
  } finally {
    button.disabled = false;
  }
}

function bindAuthActions() {
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const retryBtn = target.closest('[data-action="retry-auth-status"]');
    if (retryBtn instanceof HTMLButtonElement) {
      event.preventDefault();
      refreshAmazonAuthStatus().catch(() => {});
      return;
    }

    const connectBtn = target.closest('[data-action="connect-amazon"], [data-action="reconnect-amazon"]');
    if (connectBtn instanceof HTMLButtonElement) {
      event.preventDefault();
      handleConnectClick(connectBtn);
      return;
    }

    const disconnectBtn = target.closest('[data-action="disconnect-amazon"]');
    if (disconnectBtn instanceof HTMLButtonElement) {
      event.preventDefault();
      handleDisconnectClick(disconnectBtn);
      return;
    }

    const importBtn = target.closest('[data-action="import-self-auth"]');
    if (importBtn instanceof HTMLButtonElement) {
      event.preventDefault();
      handleImportSelfAuthClick(importBtn);
    }
  });
}

export function initAmazonAuthStatus() {
  handleAuthRedirectParams();
  bindAuthActions();
  setSyncButtonsEnabled(false);

  let failsafeTimer;
  failsafeTimer = setTimeout(() => {
    const panel = qs("#amazonAuthPanel");
    if (panel?.dataset.authState !== "loading") return;
    renderDisconnected(
      "Status check is taking too long. You can try Connect Amazon, or use Retry after signing in.",
    );
  }, 8000);

  refreshAmazonAuthStatus()
    .catch(() => {})
    .finally(() => {
      if (failsafeTimer) clearTimeout(failsafeTimer);
    });

  return {
    getState: getAuthState,
    refresh: refreshAmazonAuthStatus,
    isConnected: isAmazonConnected,
  };
}

export { hideAmazonNotification };
