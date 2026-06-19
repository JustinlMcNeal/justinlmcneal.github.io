// Growth tab — fetch and normalize posted social_posts rows

import { getSupabaseClient } from "../../../../shared/supabaseClient.js";
import { POST_STATUS_POSTED } from "../../postStatus.js";

/** @typedef {import("./growthFilters.js").GrowthDateRange} GrowthDateRange */

/**
 * @typedef {object} GrowthPostRow
 * @property {string} id
 * @property {string} platform
 * @property {string} status
 * @property {string|null} posted_at
 * @property {string|null} scheduled_for
 * @property {number} likes
 * @property {number} comments
 * @property {number} saves
 * @property {number} impressions
 * @property {number} reach
 * @property {number|null} engagement_rate
 * @property {string|null} engagement_updated_at
 * @property {Date|null} effectiveDate
 */

const SELECT_FIELDS =
  "id, platform, status, posted_at, scheduled_for, likes, comments, saves, impressions, reach, engagement_rate, engagement_updated_at";

/**
 * Resolve timeline date: posted_at primary, scheduled_for fallback for posted rows.
 * @param {object} row
 * @returns {Date|null}
 */
export function resolveGrowthPostDate(row) {
  if (row.posted_at) return new Date(row.posted_at);
  if (row.scheduled_for) {
    console.warn("[growth] posted row missing posted_at; using scheduled_for fallback", row.id);
    return new Date(row.scheduled_for);
  }
  return null;
}

/**
 * @param {object} row
 * @returns {GrowthPostRow}
 */
export function normalizeGrowthRow(row) {
  return {
    id: row.id,
    platform: row.platform,
    status: row.status,
    posted_at: row.posted_at ?? null,
    scheduled_for: row.scheduled_for ?? null,
    likes: Number(row.likes) || 0,
    comments: Number(row.comments) || 0,
    saves: Number(row.saves) || 0,
    impressions: Number(row.impressions) || 0,
    reach: Number(row.reach) || 0,
    engagement_rate:
      row.engagement_rate == null || row.engagement_rate === ""
        ? null
        : Number(row.engagement_rate),
    engagement_updated_at: row.engagement_updated_at ?? null,
    effectiveDate: resolveGrowthPostDate(row),
  };
}

/**
 * @param {GrowthPostRow[]} rows
 * @returns {Date|null}
 */
export function findEarliestPostDate(rows) {
  let earliest = null;
  for (const row of rows) {
    if (!row.effectiveDate) continue;
    if (!earliest || row.effectiveDate < earliest) earliest = row.effectiveDate;
  }
  return earliest;
}

/**
 * Fetch all posted rows for Growth dashboard (client-side period filtering).
 * Read-only — no writes.
 * @returns {Promise<{ rows: GrowthPostRow[], error: string|null }>}
 */
export async function fetchGrowthPosts() {
  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from("social_posts")
      .select(SELECT_FIELDS)
      .eq("status", POST_STATUS_POSTED)
      .order("posted_at", { ascending: true, nullsFirst: false });

    if (error) throw error;

    const rows = (data || [])
      .map(normalizeGrowthRow)
      .filter((row) => row.effectiveDate != null);

    return { rows, error: null };
  } catch (err) {
    const message = err?.message || "Could not load growth data.";
    console.error("[growth] fetchGrowthPosts failed:", err);
    return { rows: [], error: message };
  }
}
