// Scheduled verification retry queue helpers for submitted Amazon drafts.

export const VERIFY_STATUS = {
  idle: "idle",
  queued: "queued",
  running: "running",
  verified: "verified",
  not_found: "not_found",
  failed: "failed",
  max_attempts: "max_attempts",
} as const;

export type VerifyStatus = typeof VERIFY_STATUS[keyof typeof VERIFY_STATUS];

const DEFAULT_MAX_ATTEMPTS = 12;
const DEFAULT_BATCH_SIZE = 5;

export function getMaxVerifyAttempts(): number {
  const raw = Deno.env.get("AMAZON_VERIFY_MAX_ATTEMPTS");
  const parsed = raw ? Number.parseInt(raw, 10) : DEFAULT_MAX_ATTEMPTS;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_ATTEMPTS;
}

export function getVerifyBatchSize(): number {
  const raw = Deno.env.get("AMAZON_VERIFY_BATCH_SIZE");
  const parsed = raw ? Number.parseInt(raw, 10) : DEFAULT_BATCH_SIZE;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_BATCH_SIZE;
}

/** Backoff after attempt N (1-based attempt count). */
export function computeNextVerifyAfter(attemptCount: number, from = new Date()): string {
  const minutes = attemptCount <= 1 ? 5
    : attemptCount === 2 ? 15
    : attemptCount === 3 ? 30
    : 60;
  return new Date(from.getTime() + minutes * 60 * 1000).toISOString();
}

export function sanitizeVerifyError(message: unknown): string {
  return String(message || "verification_failed")
    .slice(0, 300)
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/refresh_token[^\s]*/gi, "refresh_token=[redacted]");
}

export function requireCronSecret(req: Request): boolean {
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret) return false;

  const headerSecret = req.headers.get("x-cron-secret");
  if (headerSecret && headerSecret === secret) return true;

  const auth = req.headers.get("authorization") || "";
  if (auth === `Bearer ${secret}`) return true;

  return false;
}

export async function markVerifyAttemptStart(
  // deno-lint-ignore no-explicit-any
  client: any,
  draftId: string,
  attemptCount: number,
  now: string,
): Promise<void> {
  const { error } = await client
    .from("amazon_listing_drafts")
    .update({
      verify_status: VERIFY_STATUS.running,
      verify_attempts: attemptCount,
      last_verify_attempt_at: now,
      verify_last_error: null,
      updated_at: now,
    })
    .eq("id", draftId)
    .eq("draft_status", "submitted");

  if (error) throw new Error("database_error");
}

export async function markVerifyNotFound(
  // deno-lint-ignore no-explicit-any
  client: any,
  draftId: string,
  attemptCount: number,
  now: string,
  maxAttempts: number,
): Promise<boolean> {
  const reachedMax = attemptCount >= maxAttempts;
  const { error } = await client
    .from("amazon_listing_drafts")
    .update({
      verify_status: reachedMax ? VERIFY_STATUS.max_attempts : VERIFY_STATUS.not_found,
      verify_attempts: attemptCount,
      last_verify_attempt_at: now,
      next_verify_after: reachedMax ? null : computeNextVerifyAfter(attemptCount, new Date(now)),
      verify_last_error: reachedMax ? "Max verification attempts reached" : null,
      updated_at: now,
    })
    .eq("id", draftId)
    .eq("draft_status", "submitted");

  if (error) throw new Error("database_error");
  return reachedMax;
}

export async function markVerifyFailed(
  // deno-lint-ignore no-explicit-any
  client: any,
  draftId: string,
  attemptCount: number,
  errorMessage: string,
  now: string,
  maxAttempts: number,
): Promise<boolean> {
  const reachedMax = attemptCount >= maxAttempts;
  const { error } = await client
    .from("amazon_listing_drafts")
    .update({
      verify_status: reachedMax ? VERIFY_STATUS.max_attempts : VERIFY_STATUS.failed,
      verify_attempts: attemptCount,
      last_verify_attempt_at: now,
      next_verify_after: reachedMax ? null : computeNextVerifyAfter(attemptCount, new Date(now)),
      verify_last_error: sanitizeVerifyError(errorMessage),
      updated_at: now,
    })
    .eq("id", draftId)
    .eq("draft_status", "submitted");

  if (error) throw new Error("database_error");
  return reachedMax;
}

export async function markManualVerifyNotFound(
  // deno-lint-ignore no-explicit-any
  client: any,
  draftId: string,
  now: string,
): Promise<void> {
  const { error } = await client
    .from("amazon_listing_drafts")
    .update({
      verify_status: VERIFY_STATUS.not_found,
      last_verify_attempt_at: now,
      updated_at: now,
    })
    .eq("id", draftId)
    .eq("draft_status", "submitted");

  if (error) throw new Error("database_error");
}

export async function queueDraftForVerification(
  // deno-lint-ignore no-explicit-any
  client: any,
  draftId: string,
  now: string,
): Promise<void> {
  const { error } = await client
    .from("amazon_listing_drafts")
    .update({
      verify_status: VERIFY_STATUS.queued,
      verify_attempts: 0,
      verify_last_error: null,
      last_verify_attempt_at: null,
      next_verify_after: computeNextVerifyAfter(0, new Date(now)),
      updated_at: now,
    })
    .eq("id", draftId);

  if (error) throw new Error("database_error");
}

export async function requeueDraftVerification(
  // deno-lint-ignore no-explicit-any
  client: any,
  draftId: string,
  now: string,
): Promise<void> {
  const { data, error } = await client
    .from("amazon_listing_drafts")
    .update({
      verify_status: VERIFY_STATUS.queued,
      verify_attempts: 0,
      verify_last_error: null,
      last_verify_attempt_at: null,
      next_verify_after: now,
      verify_max_attempts_alerted_at: null,
      updated_at: now,
    })
    .eq("id", draftId)
    .eq("draft_status", "submitted")
    .select("id")
    .maybeSingle();

  if (error) throw new Error("database_error");
  if (!data?.id) throw new Error("draft_not_submitted");
}

const BULK_REQUEUE_LIMIT = 50;

export async function bulkRequeueDraftVerification(
  // deno-lint-ignore no-explicit-any
  client: any,
  draftIds: string[],
  now: string,
): Promise<{
  requeued: string[];
  skipped: Array<{ draftId: string; reason: string }>;
}> {
  const requeued: string[] = [];
  const skipped: Array<{ draftId: string; reason: string }> = [];

  for (const draftId of draftIds.slice(0, BULK_REQUEUE_LIMIT)) {
    try {
      await requeueDraftVerification(client, draftId, now);
      requeued.push(draftId);
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : "requeue_failed";
      skipped.push({ draftId, reason });
    }
  }

  return { requeued, skipped };
}

export async function loadMaxAttemptsDraftIds(
  // deno-lint-ignore no-explicit-any
  client: any,
  limit = BULK_REQUEUE_LIMIT,
): Promise<string[]> {
  const { data, error } = await client
    .from("amazon_listing_drafts")
    .select("id")
    .eq("draft_status", "submitted")
    .eq("verify_status", VERIFY_STATUS.max_attempts)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error("database_error");
  return (data || []).map((row: { id: string }) => String(row.id));
}
