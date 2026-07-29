#!/usr/bin/env node
/**
 * Phase 5 — final security freeze: runs phases 1–4 checks + smoke tests.
 * Run: node scripts/verify-security-phase5-final-freeze.mjs
 */
import { spawnSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  connectPg,
  selectAsAnon,
  querySecurityDefinerFunctions,
  queryPublicViewsSecurityInvoker,
  queryTablesWithoutRls,
  queryPermissiveWritePolicies,
  queryMutableSearchPathFunctions,
  normalizePolicyRoles,
  printReport,
} from "./security/securityVerifyUtils.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const PHASE_SCRIPTS = [
  "verify-security-phase1-rpc-lockdown.mjs",
  "verify-security-phase2-core-rls.mjs",
  "verify-security-phase3-views.mjs",
  "verify-security-phase4-hardening.mjs",
];

const SENSITIVE_TABLES = [
  "customers",
  "orders_raw",
  "stripe_webhook_events",
  "personal_expenses",
];

const STOREFRONT_VIEWS = [
  "v_home_categories",
  "v_categories_public",
  "v_products_with_tags",
  "v_kk_variant_available_stock",
];

const DOCUMENTED_VIEW_EXCEPTIONS = new Set([
  "v_kk_variant_available_stock",
  "v_inventory_bundle_summary_preview",
  "v_inventory_bundle_availability_preview",
  "v_inventory_bundle_like_variants",
]);

async function runSqlFreezeChecks(client) {
  const notes = [];
  const errors = [];

  const views = await queryPublicViewsSecurityInvoker(client);
  const badViews = views.filter(
    (v) => !v.security_invoker && !DOCUMENTED_VIEW_EXCEPTIONS.has(v.view_name)
  );
  if (badViews.length) errors.push(`${badViews.length} views without security_invoker`);
  else notes.push("0 security_definer_view errors (except documented exceptions)");

  const coreRlsTargets = [
    "customers",
    "orders_raw",
    "fulfillment_shipments",
    "stripe_webhook_events",
    "shippo_webhook_events",
    "analytics_daily",
    "inventory_issue_snapshots",
  ];
  for (const t of coreRlsTargets) {
    const { rows } = await client.query(
      `SELECT c.relrowsecurity rls FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname='public' AND c.relname=$1 AND c.relkind='r'`,
      [t]
    );
    if (rows.length && !rows[0].rls) errors.push(`${t}: rls_disabled_in_public`);
  }
  if (!errors.some((e) => e.includes("rls_disabled"))) {
    notes.push("0 rls_disabled_in_public on core flagged tables");
  }

  const definer = await querySecurityDefinerFunctions(client);
  const anonBad = definer.filter(
    (f) =>
      f.anon_execute &&
      !new Set(["get_product_stock", "is_bundle_live_deduction_enabled"]).has(f.function_name)
  );
  if (anonBad.length) errors.push(`${anonBad.length} anon-callable SECURITY DEFINER RPCs`);
  else notes.push("0 anon-callable sensitive SECURITY DEFINER RPCs");

  const mutable = await queryMutableSearchPathFunctions(client);
  const unresolvedMutable = mutable.filter((f) => !f.function_name.startsWith("citext"));
  if (unresolvedMutable.length) errors.push(`${unresolvedMutable.length} functions with mutable search_path`);
  else notes.push("0 mutable search_path warnings");

  const permissive = await queryPermissiveWritePolicies(client);
  const authPermissive = permissive.filter((p) =>
    normalizePolicyRoles(p.roles).some((r) => r === "authenticated" || r === "-")
  );
  if (authPermissive.length) errors.push(`${authPermissive.length} permissive authenticated write policies`);
  else notes.push("0 unsafe permissive write policies");

  const { rows: anonGrants } = await client.query(`
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'v')
      AND has_table_privilege('anon', c.oid, 'SELECT')
      AND c.relname = ANY($1::text[])
  `, [SENSITIVE_TABLES.concat([
    "v_customers_summary",
    "v_order_financials",
    "v_inventory_workspace",
  ])]);

  if (anonGrants.length) {
    for (const g of anonGrants) errors.push(`anon SELECT grant on ${g.relname}`);
  } else {
    notes.push("No anon SELECT on sensitive tables/views checked");
  }

  return { notes, errors };
}

async function runStorefrontSmoke() {
  const notes = [];
  const errors = [];
  for (const view of STOREFRONT_VIEWS) {
    const res = await selectAsAnon(view, "*", 3);
    if (res.error) errors.push(`storefront smoke failed: ${view} — ${res.error.message}`);
    else notes.push(`storefront smoke ok: ${view}`);
  }
  return { notes, errors };
}

function runPhaseScripts() {
  const notes = [];
  const errors = [];
  for (const script of PHASE_SCRIPTS) {
    const path = join(ROOT, "scripts", script);
    if (!existsSync(path)) {
      errors.push(`missing ${script}`);
      continue;
    }
    const r = spawnSync(process.execPath, [path], { cwd: ROOT, encoding: "utf8" });
    if (r.status !== 0) errors.push(`${script} failed`);
    else notes.push(`${script} passed`);
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
  }
  return { notes, errors };
}

function checkDocs() {
  const notes = [];
  const errors = [];
  const doc = join(ROOT, "docs", "security", "KK_SECURITY_REMEDIATION.md");
  if (!existsSync(doc)) errors.push("docs/security/KK_SECURITY_REMEDIATION.md missing");
  else notes.push("KK_SECURITY_REMEDIATION.md present");

  const phase1 = join(ROOT, "docs", "security", "kk_security_phase1_rpc_secret_lockdown.md");
  if (!existsSync(phase1)) errors.push("phase 1 doc missing");
  else notes.push("phase 1 doc present");

  const migrations = [
    "20261101_security_phase1_rpc_secret_lockdown.sql",
    "20261102_security_phase2_core_rls.sql",
    "20261103_security_phase3_security_invoker_views.sql",
    "20261104_security_phase4_policy_function_storage_hardening.sql",
  ];
  for (const m of migrations) {
    const p = join(ROOT, "supabase", "migrations", m);
    if (!existsSync(p)) errors.push(`migration missing: ${m}`);
    else notes.push(`migration present: ${m}`);
  }

  const settings = readFileSync(join(ROOT, "pages", "admin", "settings.html"), "utf8");
  if (/service_role|SERVICE_KEY|eyJhbG/i.test(settings)) {
    errors.push("settings.html may contain service role material");
  } else {
    notes.push("settings.html has no service role key");
  }

  return { notes, errors };
}

async function main() {
  const allNotes = [];
  const allErrors = [];
  let client;

  try {
    const phase = runPhaseScripts();
    allNotes.push(...phase.notes);
    allErrors.push(...phase.errors);

    client = await connectPg();
    const sql = await runSqlFreezeChecks(client);
    allNotes.push(...sql.notes);
    allErrors.push(...sql.errors);

    const smoke = await runStorefrontSmoke();
    allNotes.push(...smoke.notes);
    allErrors.push(...smoke.errors);

    const docs = checkDocs();
    allNotes.push(...docs.notes);
    allErrors.push(...docs.errors);

    const ok = printReport("Security Phase 5 — Final freeze", allNotes, allErrors);
    process.exit(ok ? 0 : 1);
  } catch (err) {
    console.error(err);
    process.exit(1);
  } finally {
    if (client) await client.end();
  }
}

main();
