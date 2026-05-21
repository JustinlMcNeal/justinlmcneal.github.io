// Platform token publish health (no secret values exposed)

export const TOKEN_HEALTH_SETTING_KEYS = [
  "instagram_connected",
  "instagram_username",
  "instagram_access_token",
  "instagram_token_expires_at",
  "pinterest_connected",
  "pinterest_access_token",
  "pinterest_refresh_token",
  "pinterest_token_expires_at",
  "facebook_connected",
  "facebook_page_id",
  "facebook_page_token",
  "token_refresh_last_run",
];

export const EXPIRING_SOON_DAYS = 7;

const PLATFORM_LABELS = {
  instagram: "Instagram",
  facebook: "Facebook",
  pinterest: "Pinterest",
};

export async function fetchTokenHealthSettings(client) {
  const { data, error } = await client
    .from("social_settings")
    .select("setting_key, setting_value")
    .in("setting_key", TOKEN_HEALTH_SETTING_KEYS);

  if (error) throw error;
  return Object.fromEntries((data || []).map((r) => [r.setting_key, r.setting_value]));
}

function parseExpiry(expiresAtIso) {
  if (!expiresAtIso) return { state: "unknown", days: null, expiresAt: null };
  const expiresAt = new Date(expiresAtIso);
  if (Number.isNaN(expiresAt.getTime())) return { state: "unknown", days: null, expiresAt: null };
  const days = (expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  if (days < 0) return { state: "expired", days, expiresAt };
  if (days <= EXPIRING_SOON_DAYS) return { state: "expiring_soon", days, expiresAt };
  return { state: "valid", days, expiresAt };
}

function formatExpiryDate(date) {
  if (!date) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function isInstagramTokenValid(settings) {
  const token = settings.instagram_access_token?.token;
  if (!token) return false;
  const exp = parseExpiry(settings.instagram_token_expires_at?.expires_at);
  return exp.state === "valid" || exp.state === "expiring_soon";
}

/**
 * @returns {import('./tokenHealth.js').PlatformHealthAssessment}
 */
export function assessPlatformPublishHealth(platform, settings) {
  const displayName = PLATFORM_LABELS[platform] || platform;

  if (platform === "instagram") {
    const connected = settings.instagram_connected?.connected === true;
    const hasToken = Boolean(settings.instagram_access_token?.token);
    const username = settings.instagram_username?.username;
    const exp = parseExpiry(settings.instagram_token_expires_at?.expires_at);
    const label = username ? `@${username}` : displayName;

    let statusLine = "connected";
    let action = null;
    if (!connected) {
      statusLine = "not connected";
      action = "Reconnect Instagram (header Connect button)";
    } else if (!hasToken) {
      statusLine = "missing token";
      action = "Reconnect Instagram";
    } else if (exp.state === "expired") {
      statusLine = "token expired";
      action = "Reconnect Instagram — daily refresh cannot extend an already-expired token";
    } else if (exp.state === "expiring_soon") {
      statusLine = "token expiring soon";
      action = "Reconnect soon or confirm refresh-tokens cron succeeds";
    } else if (exp.state === "unknown") {
      statusLine = "token expiry unknown";
      action = "Reconnect Instagram to refresh expiry metadata";
    }

    const canPublish =
      connected && hasToken && (exp.state === "valid" || exp.state === "expiring_soon");

    return {
      platform,
      displayName: label,
      connected,
      hasToken,
      tokenState: exp.state,
      expiryDate: formatExpiryDate(exp.expiresAt),
      statusLine,
      action,
      canPublish,
    };
  }

  if (platform === "pinterest") {
    const connected = settings.pinterest_connected?.connected === true;
    const hasToken = Boolean(settings.pinterest_access_token?.token);
    const hasRefresh = Boolean(settings.pinterest_refresh_token?.token);
    const exp = parseExpiry(settings.pinterest_token_expires_at?.expires_at);

    let statusLine = "connected";
    let action = null;
    if (!connected) {
      statusLine = "not connected";
      action = "Reconnect Pinterest";
    } else if (!hasToken) {
      statusLine = "missing token";
      action = "Reconnect Pinterest";
    } else if (exp.state === "expired") {
      statusLine = "token expired";
      action = hasRefresh
        ? "Reconnect Pinterest or check refresh-tokens logs (refresh may have failed)"
        : "Reconnect Pinterest — no refresh token on file";
    } else if (exp.state === "expiring_soon") {
      statusLine = "token expiring soon";
      action = "Confirm refresh-tokens cron runs daily";
    }

    const canPublish =
      connected && hasToken && (exp.state === "valid" || exp.state === "expiring_soon");

    return {
      platform,
      displayName,
      connected,
      hasToken,
      tokenState: exp.state,
      expiryDate: formatExpiryDate(exp.expiresAt),
      statusLine,
      action,
      canPublish,
    };
  }

  if (platform === "facebook") {
    const connected = settings.facebook_connected?.connected === true;
    const hasPageToken = Boolean(settings.facebook_page_token?.token);
    const hasPageId = Boolean(settings.facebook_page_id?.page_id);
    const igValid = isInstagramTokenValid(settings);

    let statusLine = "connected";
    let action = null;
    if (!hasPageToken && !hasPageId) {
      statusLine = connected ? "missing page token" : "not connected";
      action = igValid
        ? "Reconnect via Instagram OAuth to store Facebook page token"
        : "Connect Instagram/Facebook (same OAuth flow)";
    } else if (!hasPageToken || !hasPageId) {
      statusLine = "incomplete setup";
      action = "Reconnect via Instagram OAuth (page id + token)";
    } else if (!igValid) {
      statusLine = "page token present · Instagram token invalid";
      action = "Reconnect Instagram — Facebook posts may fail if page token is stale";
    }

    const canPublish = hasPageToken && hasPageId && (igValid || hasPageToken);

    return {
      platform,
      displayName,
      connected: connected || (hasPageToken && hasPageId),
      hasToken: hasPageToken,
      tokenState: hasPageToken && hasPageId ? (igValid ? "valid" : "unknown") : "missing",
      expiryDate: "",
      statusLine,
      action,
      canPublish: hasPageToken && hasPageId,
    };
  }

  return {
    platform,
    displayName,
    connected: false,
    hasToken: false,
    tokenState: "unknown",
    expiryDate: "",
    statusLine: "unknown platform",
    action: null,
    canPublish: false,
  };
}

/** Assess only platforms selected in autopilot settings. */
export function assessAutopilotPlatformHealth(autopilotSettings, tokenSettings) {
  const platforms = autopilotSettings?.platforms?.length
    ? autopilotSettings.platforms
    : ["instagram"];
  return platforms.map((p) => assessPlatformPublishHealth(p, tokenSettings));
}

export function hasBlockingAutopilotTokenIssues(assessments) {
  return assessments.some((a) => !a.canPublish);
}

export function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderTokenHealthListHtml(assessments) {
  if (!assessments.length) {
    return '<p class="text-xs text-gray-500">No platforms selected in autopilot.</p>';
  }
  const items = assessments
    .map((a) => {
      const ok = a.canPublish;
      const color = ok ? "text-green-800" : "text-red-800";
      const icon = ok ? "✓" : "⚠";
      const expiry =
        a.expiryDate && a.tokenState !== "missing"
          ? ` · expires ${escapeHtml(a.expiryDate)}`
          : "";
      const action = a.action && !ok
        ? ` — <span class="text-amber-900">${escapeHtml(a.action)}</span>`
        : "";
      return `<li class="text-xs ${color}">${icon} <strong>${escapeHtml(a.displayName)}</strong>: ${escapeHtml(a.statusLine)}${expiry}${action}</li>`;
    })
    .join("");
  return `<ul class="space-y-1 list-none">${items}</ul>`;
}

export function sanitizePublishError(message) {
  if (!message) return "Unknown error";
  let s = String(message).slice(0, 220);
  s = s.replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
  s = s.replace(/access_token[=:]\s*\S+/gi, "access_token=[redacted]");
  s = s.replace(/https?:\/\/\S{80,}/gi, "[url redacted]");
  return s;
}

export async function fetchLatestFailedPost(client) {
  const { data, error } = await client
    .from("social_posts")
    .select("id, platform, status, scheduled_for, updated_at, error_message")
    .eq("status", "failed")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}
