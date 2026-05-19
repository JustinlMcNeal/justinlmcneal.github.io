/**
 * Canonical social_posts.status values (admin social).
 * @see supabase/migrations/20260720_social_posts_status_alignment.sql
 * @see docs/audit/pages/admin-social/013_admin_social_phase2c_prod_verification.md
 */

export const POST_STATUS_POSTED = "posted";
export const POST_STATUS_PROCESSING = "processing";

/** Success statuses for Supabase .in() filters */
export const POST_SUCCESS_STATUSES = [POST_STATUS_POSTED];

export function isPostedSuccessStatus(status) {
  return status === POST_STATUS_POSTED;
}
