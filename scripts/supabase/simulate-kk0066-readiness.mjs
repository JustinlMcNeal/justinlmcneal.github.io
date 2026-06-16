#!/usr/bin/env node
import pg from "pg";

// Inline the readiness helpers (mirror server logic)
function parseIsoMs(value) {
  if (!value) return null;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
}

function hasRecentValidationPreview(draft) {
  const lastResponse = draft.last_submission_response || {};
  if (!lastResponse || lastResponse.mode !== "VALIDATION_PREVIEW") return false;
  const status = String(draft.submission_status || lastResponse.status || "").toUpperCase();
  return status === "VALID" || status === "ACCEPTED";
}

function isPtdPreviewCurrent(draft) {
  const lastResult = draft.last_validation_result || {};
  const previewedAt = parseIsoMs(lastResult.previewedAt);
  if (previewedAt === null) return false;
  const productType = draft.product_type;
  const previewProductType = lastResult.productType;
  if (!productType || previewProductType !== productType) return false;
  const updatedAt = parseIsoMs(draft.updated_at);
  if (updatedAt === null) return true;
  const amazonPreviewAt = parseIsoMs(lastResult.amazonPreviewAt);
  const freshnessAnchor = amazonPreviewAt !== null && amazonPreviewAt >= previewedAt
    ? amazonPreviewAt
    : previewedAt;
  return updatedAt <= freshnessAnchor;
}

function evaluateDraftLiveSubmitReadiness(draft, openIssues) {
  const reasons = [];
  if (String(draft.draft_status) !== "ready_to_submit") reasons.push("draft_status_not_ready");
  if (!draft.product_type) reasons.push("missing_product_type");
  const lastResult = draft.last_validation_result || {};
  if (!lastResult || !Object.keys(lastResult).length) reasons.push("missing_last_validation_result");
  if (!hasRecentValidationPreview(draft) && !isPtdPreviewCurrent(draft)) reasons.push("ptd_preview_required");
  if (!hasRecentValidationPreview(draft)) reasons.push("amazon_validation_preview_required");
  if (openIssues.some((i) => i.source === "validation" && i.severity === "error")) reasons.push("open_validation_errors");
  if (openIssues.some((i) => i.source === "push" && i.severity === "error")) reasons.push("open_push_errors");
  return { ready: reasons.length === 0, reasons };
}

const client = new pg.Client({
  connectionString: `postgresql://postgres:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)}@db.yxdzvzscufkvewecvagq.supabase.co:5432/postgres`,
  ssl: { rejectUnauthorized: false },
});
await client.connect();
const { rows } = await client.query(`SELECT * FROM amazon_listing_drafts WHERE kk_sku ILIKE '%0066%' ORDER BY updated_at DESC LIMIT 1`);
const draft = rows[0];
const openIssues = [];
const result = evaluateDraftLiveSubmitReadiness(draft, openIssues);
console.log("updated_at:", draft.updated_at);
console.log("amazonPreviewAt:", draft.last_validation_result?.amazonPreviewAt);
console.log("isPtdPreviewCurrent:", isPtdPreviewCurrent(draft));
console.log("hasRecentValidationPreview:", hasRecentValidationPreview(draft));
console.log("readiness:", result);
await client.end();
