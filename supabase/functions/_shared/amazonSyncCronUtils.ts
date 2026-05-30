// Cron-specific config for scheduled Amazon listing sync.

import { requireCronSecret } from "./amazonDraftVerifyQueueUtils.ts";

export { requireCronSecret };

const DEFAULT_MAX_PAGES = 5;
const DEFAULT_BATCH_ACCOUNTS = 3;

export function getCronMaxPages(): number {
  const raw = Deno.env.get("AMAZON_SYNC_CRON_MAX_PAGES");
  const parsed = raw ? Number.parseInt(raw, 10) : DEFAULT_MAX_PAGES;
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_PAGES;
  return Math.min(10, parsed);
}

export function getCronBatchAccounts(): number {
  const raw = Deno.env.get("AMAZON_SYNC_CRON_BATCH_ACCOUNTS");
  const parsed = raw ? Number.parseInt(raw, 10) : DEFAULT_BATCH_ACCOUNTS;
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_BATCH_ACCOUNTS;
  return parsed;
}
