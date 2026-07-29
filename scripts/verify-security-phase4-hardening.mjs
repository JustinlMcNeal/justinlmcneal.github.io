#!/usr/bin/env node
/**
 * Phase 4 — verify policy, function search_path, storage, personal_expenses hardening.
 * Run: node scripts/verify-security-phase4-hardening.mjs
 */
import {
  connectPg,
  selectAsAnon,
  queryPermissiveWritePolicies,
  queryMutableSearchPathFunctions,
  normalizePolicyRoles,
  printReport,
} from "./security/securityVerifyUtils.mjs";

const SEARCH_PATH_EXCEPTIONS = new Set([]);

const PUBLIC_LIST_BUCKETS = ["banners", "looks", "products", "social-media"];

async function main() {
  const notes = [];
  const errors = [];
  let client;

  try {
    client = await connectPg();

    const permissive = await queryPermissiveWritePolicies(client);
    const bad = permissive.filter(
      (p) =>
        !["push_subscriptions", "pwa_events"].includes(p.table_name) &&
        normalizePolicyRoles(p.roles).some((r) => r === "authenticated" || r === "-")
    );

    if (bad.length) {
      for (const p of bad.slice(0, 15)) {
        errors.push(`permissive write policy ${p.table_name}.${p.policy_name}`);
      }
      if (bad.length > 15) errors.push(`... ${bad.length - 15} more permissive write policies`);
    } else {
      notes.push("No authenticated permissive write policies using true");
    }

    const mutable = await queryMutableSearchPathFunctions(client);
    const unresolved = mutable.filter(
      (f) =>
        !SEARCH_PATH_EXCEPTIONS.has(f.function_name) &&
        !f.function_name.startsWith("citext")
    );
    if (unresolved.length) {
      for (const f of unresolved.slice(0, 15)) {
        errors.push(`mutable search_path: ${f.function_name}(${f.args})`);
      }
      if (unresolved.length > 15) errors.push(`... ${unresolved.length - 15} more mutable search_path functions`);
    } else {
      notes.push("All public functions have fixed search_path (or documented exceptions)");
    }

    for (const op of ["insert", "update", "delete"]) {
      const row = { expense_date: "2026-01-01", description: "sec-test", category: "other", amount_cents: 1 };
      const sb = (await import("./security/securityVerifyUtils.mjs")).anonClient();
      let res;
      if (op === "insert") res = await sb.from("personal_expenses").insert(row);
      else if (op === "update") res = await sb.from("personal_expenses").update({ notes: "x" }).eq("description", "sec-test");
      else res = await sb.from("personal_expenses").delete().eq("description", "sec-test");
      if (!res.error) errors.push(`personal_expenses anon ${op} should be denied`);
      else notes.push(`personal_expenses anon ${op} denied`);
    }

    const { rows: storagePolicies } = await client.query(`
      SELECT policyname, qual, with_check
      FROM pg_policies
      WHERE schemaname = 'storage'
        AND tablename = 'objects'
        AND cmd = 'SELECT'
        AND (
          qual LIKE '%bucket_id = ''banners''%'
          OR qual LIKE '%bucket_id = ''looks''%'
          OR qual LIKE '%bucket_id = ''products''%'
          OR qual LIKE '%bucket_id = ''social-media''%'
        )
        AND qual NOT LIKE '%is_admin%'
    `);

    if (storagePolicies.length) {
      for (const p of storagePolicies) {
        errors.push(`public storage listing policy remains: ${p.policyname}`);
      }
    } else {
      notes.push("No public storage bucket listing policies on flagged buckets");
    }

    for (const bucket of PUBLIC_LIST_BUCKETS) {
      const sb = (await import("./security/securityVerifyUtils.mjs")).anonClient();
      const res = await sb.storage.from(bucket).list("", { limit: 5 });
      if (!res.error && Array.isArray(res.data) && res.data.length >= 0) {
        // list without error means listing may still work — flag if data returned
        if (res.data.length > 0) errors.push(`anon can list storage bucket ${bucket}`);
        else notes.push(`storage bucket ${bucket}: anon list empty or restricted`);
      } else {
        notes.push(`storage bucket ${bucket}: anon list denied or empty`);
      }
    }

    const ok = printReport("Security Phase 4 — Hardening", notes, errors);
    process.exit(ok ? 0 : 1);
  } catch (err) {
    console.error(err);
    process.exit(1);
  } finally {
    if (client) await client.end();
  }
}

main();
