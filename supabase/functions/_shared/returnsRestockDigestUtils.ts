// Returns/restock digest builders (Phase 10W — read-only reporting).

import { SITE_URL } from "./amazonAuthUtils.ts";

export type DigestSummaryRow = {
  open_returns: number;
  received_not_restocked: number;
  ready_to_restock: number;
  stale_observations: number;
  open_channel_followups: number;
  sync_review_suggested: number;
  blocked_manual_review: number;
  recent_restocks_24h: number;
  recent_restocks_7d: number;
  recent_restocked_qty_7d: number;
  overdue_followups: number;
  oldest_stale_observation_age_hours: number | null;
  dashboard_attention_count: number;
  generated_at?: string;
};

export type DigestItemRow = {
  digest_section: string;
  row_id: string;
  row_type: string;
  priority: number;
  source_channel: string | null;
  source_order_id: string | null;
  source_order_item_id: string | null;
  reservation_id: string | null;
  restock_action_id: string | null;
  component_sku: string | null;
  component_title: string | null;
  parent_bundle_sku: string | null;
  parent_bundle_title: string | null;
  status: string | null;
  reason: string | null;
  recommended_action: string | null;
  is_observation_stale: boolean;
  observation_age_hours: number | null;
  suggested_restock_qty: number | null;
  max_restockable_qty: number | null;
  event_at: string | null;
};

export type DigestPresetLinks = {
  dashboard: string;
  ready: string;
  stale: string;
  followups: string;
  manual: string;
};

const INVENTORY_ADMIN_PATH = "/pages/admin/inventory.html";

export function buildDigestPresetLinks(baseSiteUrl = SITE_URL): DigestPresetLinks {
  const base = `${baseSiteUrl.replace(/\/$/, "")}${INVENTORY_ADMIN_PATH}`;
  const q = (params: Record<string, string>) => {
    const p = new URLSearchParams({ returns_dashboard: "1", ...params });
    return `${base}?${p.toString()}`;
  };
  return {
    dashboard: q({}),
    ready: q({ tab: "ready" }),
    stale: q({ stale_only: "1" }),
    followups: q({ tab: "followups" }),
    manual: q({ row_type: "manual_review" }),
  };
}

export function scheduleWindowForRunType(runType: "daily" | "weekly" | "manual"): string {
  const d = new Date();
  if (runType === "manual") return `manual-${d.toISOString()}`;
  if (runType === "weekly") {
    const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const dayNum = day.getUTCDay() || 7;
    day.setUTCDate(day.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((day.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    return `${day.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
  }
  return d.toISOString().slice(0, 10);
}

function sectionLabel(section: string): string {
  const map: Record<string, string> = {
    ready_restock: "Ready to Restock",
    stale_observation: "Stale Observations",
    open_followup: "Open Channel Follow-Ups",
    manual_review: "Manual Review",
  };
  return map[section] || section;
}

function formatItemLine(item: DigestItemRow): string {
  const sku = item.component_sku || "—";
  const title = item.component_title || item.parent_bundle_title || sku;
  const ch = item.source_channel || "—";
  const ord = item.source_order_id ? ` · ${item.source_order_id}` : "";
  const stale = item.is_observation_stale && item.observation_age_hours != null
    ? ` · stale ${item.observation_age_hours}h`
    : "";
  return `  • ${title} (${sku}) [${ch}]${ord}${stale} — ${item.status || item.reason || "review"}`;
}

export function formatDigestText(
  summary: DigestSummaryRow,
  items: DigestItemRow[],
  links: DigestPresetLinks,
  runType: string,
): string {
  const lines = [
    `KK Returns & Restock Digest (${runType})`,
    `Generated: ${summary.generated_at || new Date().toISOString()}`,
    "",
    "Summary",
    `  Open returns: ${summary.open_returns}`,
    `  Received not restocked: ${summary.received_not_restocked}`,
    `  Ready to restock: ${summary.ready_to_restock}`,
    `  Stale observations: ${summary.stale_observations}`,
    `  Open channel follow-ups: ${summary.open_channel_followups}`,
    `  Sync review suggested: ${summary.sync_review_suggested}`,
    `  Blocked / manual review: ${summary.blocked_manual_review}`,
    `  Recent restocks (24h / 7d): ${summary.recent_restocks_24h} / ${summary.recent_restocks_7d}`,
    `  Overdue follow-ups (>7d): ${summary.overdue_followups}`,
    `  Oldest stale obs age (h): ${summary.oldest_stale_observation_age_hours ?? "—"}`,
    `  Attention items: ${summary.dashboard_attention_count}`,
    "",
    "Dashboard links",
    `  All: ${links.dashboard}`,
    `  Ready to Restock: ${links.ready}`,
    `  Stale Observations: ${links.stale}`,
    `  Follow-Ups: ${links.followups}`,
    `  Manual Review: ${links.manual}`,
    "",
  ];

  const sections = ["ready_restock", "stale_observation", "open_followup", "manual_review"];
  for (const section of sections) {
    const sectionItems = items.filter((i) => i.digest_section === section);
    lines.push(sectionLabel(section));
    if (!sectionItems.length) {
      lines.push("  (none)");
    } else {
      for (const item of sectionItems) lines.push(formatItemLine(item));
    }
    lines.push("");
  }

  lines.push("Informational only — no automatic restock, RMA, or channel sync.");
  return lines.join("\n");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function formatDigestHtml(
  summary: DigestSummaryRow,
  items: DigestItemRow[],
  links: DigestPresetLinks,
  runType: string,
): string {
  const text = formatDigestText(summary, items, links, runType);
  const linkBlock = `
    <p><strong>Dashboard</strong></p>
    <ul>
      <li><a href="${escapeHtml(links.dashboard)}">Open Dashboard</a></li>
      <li><a href="${escapeHtml(links.ready)}">Ready to Restock</a></li>
      <li><a href="${escapeHtml(links.stale)}">Stale Observations</a></li>
      <li><a href="${escapeHtml(links.followups)}">Channel Follow-Ups</a></li>
      <li><a href="${escapeHtml(links.manual)}">Manual Review</a></li>
    </ul>`;

  return `<!DOCTYPE html><html><body style="font-family:sans-serif;font-size:14px;line-height:1.4">
    <h2>KK Returns &amp; Restock Digest (${escapeHtml(runType)})</h2>
    <pre style="white-space:pre-wrap;background:#f8fafc;padding:12px;border-radius:6px">${escapeHtml(text)}</pre>
    ${linkBlock}
    <p style="color:#666;font-size:12px">Informational only — no automatic restock, RMA, or channel sync.</p>
  </body></html>`;
}

// deno-lint-ignore no-explicit-any
export async function fetchDigestData(client: any): Promise<{ summary: DigestSummaryRow; items: DigestItemRow[] }> {
  const { data: summary, error: summaryErr } = await client
    .from("v_inventory_returns_restock_digest_summary")
    .select("*")
    .maybeSingle();
  if (summaryErr) throw new Error(summaryErr.message || "digest_summary_failed");

  const { data: items, error: itemsErr } = await client
    .from("v_inventory_returns_restock_digest_items")
    .select("*")
    .order("digest_section", { ascending: true })
    .order("priority", { ascending: true });
  if (itemsErr) throw new Error(itemsErr.message || "digest_items_failed");

  return {
    summary: (summary || {}) as DigestSummaryRow,
    items: (items || []) as DigestItemRow[],
  };
}

export async function sendDigestEmail(to: string, subject: string, text: string, html: string): Promise<void> {
  const apiKey = Deno.env.get("RESEND_API_KEY")?.trim();
  if (!apiKey) throw new Error("email_not_configured");

  const from = Deno.env.get("RETURNS_RESTOCK_DIGEST_EMAIL_FROM")?.trim() ||
    Deno.env.get("AMAZON_VERIFY_ALERT_EMAIL_FROM")?.trim() ||
    "Karry Kraze Admin <noreply@karrykraze.com>";

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to: [to], subject, text, html }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`email_send_failed:${resp.status}:${body.slice(0, 200)}`);
  }
}

export function digestEmailConfigured(): boolean {
  return Boolean(
    Deno.env.get("RESEND_API_KEY")?.trim() &&
    Deno.env.get("RETURNS_RESTOCK_DIGEST_EMAIL_TO")?.trim(),
  );
}

export function summaryCountsPayload(summary: DigestSummaryRow): Record<string, number | null> {
  return {
    open_returns: summary.open_returns,
    received_not_restocked: summary.received_not_restocked,
    ready_to_restock: summary.ready_to_restock,
    stale_observations: summary.stale_observations,
    open_channel_followups: summary.open_channel_followups,
    sync_review_suggested: summary.sync_review_suggested,
    blocked_manual_review: summary.blocked_manual_review,
    recent_restocks_24h: summary.recent_restocks_24h,
    recent_restocks_7d: summary.recent_restocks_7d,
    overdue_followups: summary.overdue_followups,
    dashboard_attention_count: summary.dashboard_attention_count,
    oldest_stale_observation_age_hours: summary.oldest_stale_observation_age_hours,
  };
}
