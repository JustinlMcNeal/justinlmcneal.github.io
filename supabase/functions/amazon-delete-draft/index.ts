// amazon-delete-draft — Admin-only local draft removal (no Amazon calls).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersJson, json, requireAdminJson, UUID_RE } from "../_shared/amazonAuthUtils.ts";
import { deleteLocalAmazonDraft } from "../_shared/amazonDeleteDraftUtils.ts";

const LOG_PREFIX = "[amazon-delete-draft]";

type DeletePayload = {
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

  let body: DeletePayload = {};
  try {
    body = (await req.json()) as DeletePayload;
  } catch {
    return json({ ok: false, error: "invalid_request" }, 400);
  }

  const draftId = parseUuid(body.draftId);
  if (!draftId) {
    return json({ ok: false, error: "invalid_request" }, 400);
  }

  const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const result = await deleteLocalAmazonDraft(serviceClient, draftId);
    console.log(`${LOG_PREFIX} deleted draftId=${draftId} status=${result.draftStatus}`);
    return json({
      ok: true,
      draftId: result.draftId,
      draftStatus: result.draftStatus,
      kkProductId: result.kkProductId,
    });
  } catch (err: unknown) {
    if (err instanceof Error) {
      if (err.message === "draft_not_found") {
        return json({ ok: false, error: "draft_not_found" }, 404);
      }
      if (err.message === "draft_not_deletable") {
        return json({ ok: false, error: "draft_not_deletable" }, 400);
      }
      if (err.message === "database_error") {
        return json({ ok: false, error: "database_error" }, 500);
      }
    }
    console.log(`${LOG_PREFIX} database_error`);
    return json({ ok: false, error: "database_error" }, 500);
  }
});
