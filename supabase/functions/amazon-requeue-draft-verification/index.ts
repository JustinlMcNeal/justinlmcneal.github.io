// amazon-requeue-draft-verification — Admin reset of verification retry metadata (no Amazon calls).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersJson, json, requireAdminJson, UUID_RE } from "../_shared/amazonAuthUtils.ts";
import { requeueDraftVerification } from "../_shared/amazonDraftVerifyQueueUtils.ts";

const LOG_PREFIX = "[amazon-requeue-draft-verification]";

type RequeuePayload = {
  draftId?: unknown;
};

function parseUuid(value: unknown): string | null {
  if (typeof value !== "string" || !UUID_RE.test(value.trim())) return null;
  return value.trim();
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

  let body: RequeuePayload = {};
  try {
    body = (await req.json()) as RequeuePayload;
  } catch {
    return json({ ok: false, error: "invalid_request" }, 400);
  }

  const draftId = parseUuid(body.draftId);
  if (!draftId) {
    return json({ ok: false, error: "invalid_request" }, 400);
  }

  const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
  const now = new Date().toISOString();

  try {
    const { data: draftRaw, error: draftErr } = await serviceClient
      .from("amazon_listing_drafts")
      .select("id, draft_status")
      .eq("id", draftId)
      .maybeSingle();

    if (draftErr) {
      return json({ ok: false, error: "database_error" }, 500);
    }
    if (!draftRaw) {
      return json({ ok: false, error: "draft_not_found" }, 404);
    }
    if (String(draftRaw.draft_status) !== "submitted") {
      return json({ ok: false, error: "draft_not_submitted" }, 400);
    }

    await requeueDraftVerification(serviceClient, draftId, now);

    console.log(`${LOG_PREFIX} requeued draftId=${draftId}`);
    return json({
      ok: true,
      draftId,
      verifyStatus: "queued",
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "draft_not_submitted") {
      return json({ ok: false, error: "draft_not_submitted" }, 400);
    }
    if (err instanceof Error && err.message === "database_error") {
      return json({ ok: false, error: "database_error" }, 500);
    }
    console.log(`${LOG_PREFIX} database_error`);
    return json({ ok: false, error: "database_error" }, 500);
  }
});
