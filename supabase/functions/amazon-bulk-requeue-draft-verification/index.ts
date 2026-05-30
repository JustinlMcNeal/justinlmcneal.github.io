// amazon-bulk-requeue-draft-verification — Admin bulk reset of verify retry metadata (no Amazon calls).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersJson, json, requireAdminJson, UUID_RE } from "../_shared/amazonAuthUtils.ts";
import {
  bulkRequeueDraftVerification,
  loadMaxAttemptsDraftIds,
} from "../_shared/amazonDraftVerifyQueueUtils.ts";

const LOG_PREFIX = "[amazon-bulk-requeue-draft-verification]";

type BulkPayload = {
  draftIds?: unknown;
  allMaxAttempts?: unknown;
};

function parseUuid(value: unknown): string | null {
  if (typeof value !== "string" || !UUID_RE.test(value.trim())) return null;
  return value.trim();
}

function parseDraftIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const entry of value) {
    const id = parseUuid(entry);
    if (id) ids.push(id);
  }
  return [...new Set(ids)];
}

Deno.serve(async (req) => {
  console.log(`${LOG_PREFIX} start`);

  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeadersJson });
  }

  if (req.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
    return json({ ok: false, error: "server_misconfigured" }, 500);
  }

  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  const admin = await requireAdminJson(
    createClient,
    supabaseUrl,
    supabaseAnonKey,
    authHeader,
    LOG_PREFIX,
  );
  if (!admin.ok) return admin.response;

  let body: BulkPayload = {};
  try {
    body = (await req.json()) as BulkPayload;
  } catch {
    return json({ ok: false, error: "invalid_request" }, 400);
  }

  const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
  const now = new Date().toISOString();

  try {
    let draftIds = parseDraftIds(body.draftIds);
    const useAllMax = body.allMaxAttempts !== false;

    if (!draftIds.length && useAllMax) {
      draftIds = await loadMaxAttemptsDraftIds(serviceClient);
    }

    if (!draftIds.length) {
      return json({ ok: false, error: "no_drafts_to_requeue" }, 400);
    }

    const result = await bulkRequeueDraftVerification(serviceClient, draftIds, now);

    console.log(`${LOG_PREFIX} requeued=${result.requeued.length} skipped=${result.skipped.length}`);
    return json({
      ok: true,
      requeuedCount: result.requeued.length,
      skippedCount: result.skipped.length,
      requeued: result.requeued,
      skipped: result.skipped,
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "database_error") {
      return json({ ok: false, error: "database_error" }, 500);
    }
    console.log(`${LOG_PREFIX} database_error`);
    return json({ ok: false, error: "database_error" }, 500);
  }
});
