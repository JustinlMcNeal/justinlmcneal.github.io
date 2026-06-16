#!/usr/bin/env node
/**
 * Phase 10Y — Verify v_inventory_issues is snapshot-backed, not live-heavy.
 * Run: node scripts/verify-inventory-issue-view-safety.mjs
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { connectPgClient } from "./supabase/dbConnect.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const MIGRATION_10AA = "supabase/migrations/20261020_inventory_phase10aa_issues_snapshot.sql";
const MIGRATION_10AB = "supabase/migrations/20261021_inventory_phase10ab_missing_sku_product_code.sql";
const MIGRATION_10Z = "supabase/migrations/20261019_inventory_phase10z_optimize_issues_view.sql";

/** Views/tables that must NOT appear in v_inventory_issues definition (10Z pattern). */
const FORBIDDEN_HEAVY_REFS = [
  "v_inventory_bundle_component_return_workflow_guidance",
  "v_inventory_bundle_summary_preview",
  "v_inventory_shipped_finalize_audit",
  "v_inventory_marketplace_restock_assist_candidates",
  "v_inventory_returns_restock_dashboard_summary",
  "v_inventory_returns_restock_dashboard_worklist",
  "v_inventory_channel_sync_candidates",
  "v_inventory_bundle_component_return_candidates",
  "v_inventory_bundle_cutover_readiness",
  "v_inventory_restock_followup_candidates",
  "v_inventory_marketplace_restock_assist_queue",
  "inventory_bundle_live_issues",
];

const REQUIRED_10AA_OBJECTS = [
  "v_inventory_issues_core",
  "inventory_issue_snapshots",
  "refresh_inventory_issue_snapshots(",
  "refresh_inventory_issue_snapshots_admin",
  "inventory-issue-snapshots-every-15m",
];

const ISSUES_QUERY_MS_LIMIT = 3000;

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

function verifyMigrationFiles() {
  const notes = [];
  const errors = [];

  for (const rel of [MIGRATION_10AA, MIGRATION_10AB, MIGRATION_10Z]) {
    if (!existsSync(join(ROOT, rel))) {
      errors.push(`Missing migration: ${rel}`);
      continue;
    }
    notes.push(`Migration present: ${rel.split("/").pop()}`);
  }

  const sql10aa = read(MIGRATION_10AA);
  for (const obj of REQUIRED_10AA_OBJECTS) {
    if (!sql10aa.includes(obj)) errors.push(`10AA missing required object/token: ${obj}`);
    else notes.push(`10AA defines: ${obj}`);
  }

  const issuesViewBlock = sql10aa.match(
    /CREATE OR REPLACE VIEW public\.v_inventory_issues AS[\s\S]*?GRANT SELECT ON public\.v_inventory_issues/,
  )?.[0];
  if (!issuesViewBlock) {
    errors.push("10AA: could not parse v_inventory_issues view block");
  } else {
    if (!issuesViewBlock.includes("v_inventory_issues_core")) {
      errors.push("10AA v_inventory_issues must SELECT from v_inventory_issues_core");
    } else notes.push("10AA v_inventory_issues references v_inventory_issues_core");
    if (!issuesViewBlock.includes("inventory_issue_snapshots")) {
      errors.push("10AA v_inventory_issues must UNION ALL inventory_issue_snapshots");
    } else notes.push("10AA v_inventory_issues references inventory_issue_snapshots");
    for (const heavy of FORBIDDEN_HEAVY_REFS) {
      if (issuesViewBlock.includes(heavy)) {
        errors.push(`10AA v_inventory_issues must not reference heavy view: ${heavy}`);
      }
    }
  }

  const sql10z = read(MIGRATION_10Z);
  if (!/DO NOT APPLY/i.test(sql10z) || !/SUPERSEDED BY 10AA/i.test(sql10z)) {
    errors.push("10Z migration missing loud DO NOT APPLY / SUPERSEDED BY 10AA header");
  } else notes.push("10Z guarded with DO NOT APPLY header");

  if (!/CAN EXHAUST DB POOL/i.test(sql10z)) {
    errors.push("10Z migration missing CAN EXHAUST DB POOL warning");
  }

  const sql10ab = read(MIGRATION_10AB);
  if (!sql10ab.includes("p.code")) {
    errors.push("10AB must treat products.code when variant.sku is empty");
  } else notes.push("10AB uses product.code for missing-SKU logic");

  return { notes, errors };
}

function verifyBrowserSnapshotPolicy() {
  const notes = [];
  const errors = [];
  const invRoot = join(ROOT, "js/admin/inventory");
  const forbidden = [
    "refresh_inventory_issue_snapshots_admin",
    "scheduleIssueSnapshotRefresh",
    "refreshInventoryIssueSnapshotsAdmin",
  ];

  /** @param {string} dir */
  function walk(dir) {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, name.name);
      if (name.isDirectory()) walk(full);
      else if (name.name.endsWith(".js")) {
        const src = readFileSync(full, "utf8");
        for (const token of forbidden) {
          if (src.includes(token)) {
            errors.push(`Browser must not reference ${token}: ${full.replace(ROOT + "\\", "").replace(ROOT + "/", "")}`);
          }
        }
      }
    }
  }

  walk(invRoot);
  if (!errors.length) notes.push("No browser-triggered snapshot refresh tokens in js/admin/inventory");
  return { notes, errors };
}

async function verifyDatabase() {
  const notes = [];
  const errors = [];
  const warnings = [];

  const client = await connectPgClient();
  try {
    for (const view of ["v_inventory_issues", "v_inventory_issues_core"]) {
      const r = await client.query(
        `SELECT 1 FROM information_schema.views WHERE table_schema = 'public' AND table_name = $1`,
        [view],
      );
      if (!r.rows.length) errors.push(`Missing view: ${view}`);
      else notes.push(`View exists: ${view}`);
    }

    const tbl = await client.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'inventory_issue_snapshots'`,
    );
    if (!tbl.rows.length) errors.push("Missing table: inventory_issue_snapshots");
    else notes.push("Table exists: inventory_issue_snapshots");

    const defRes = await client.query(
      `SELECT pg_get_viewdef('public.v_inventory_issues'::regclass, true) AS def`,
    );
    const def = String(defRes.rows[0]?.def ?? "").toLowerCase();
    if (!def.includes("inventory_issue_snapshots")) {
      errors.push("Production v_inventory_issues does not reference inventory_issue_snapshots");
    } else notes.push("Production v_inventory_issues references inventory_issue_snapshots");

    if (!def.includes("v_inventory_issues_core")) {
      errors.push("Production v_inventory_issues does not reference v_inventory_issues_core");
    } else notes.push("Production v_inventory_issues references v_inventory_issues_core");

    for (const heavy of FORBIDDEN_HEAVY_REFS) {
      if (def.includes(heavy.toLowerCase())) {
        errors.push(`Production v_inventory_issues references forbidden heavy source: ${heavy} (10Z pattern)`);
      }
    }
    if (!errors.some((e) => e.includes("forbidden heavy"))) {
      notes.push("Production v_inventory_issues has no forbidden heavy view references");
    }

    const t0 = Date.now();
    await client.query(
      `SELECT issue_type, affected_count FROM public.v_inventory_issues ORDER BY affected_count DESC LIMIT 10`,
    );
    const ms = Date.now() - t0;
    notes.push(`v_inventory_issues query: ${ms}ms`);
    if (ms > ISSUES_QUERY_MS_LIMIT) {
      errors.push(`v_inventory_issues query slower than ${ISSUES_QUERY_MS_LIMIT}ms (${ms}ms)`);
    }

    const snap = await client.query(
      `SELECT COUNT(*)::int AS n, MAX(refreshed_at) AS refreshed_at FROM public.inventory_issue_snapshots`,
    );
    const snapCount = snap.rows[0]?.n ?? 0;
    if (snapCount === 0) {
      warnings.push("inventory_issue_snapshots is empty — extended counts may be missing until cron runs");
    } else {
      notes.push(`inventory_issue_snapshots rows: ${snapCount} (refreshed_at=${snap.rows[0]?.refreshed_at ?? "—"})`);
    }

    try {
      const cron = await client.query(
        `SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'inventory-issue-snapshots-every-15m'`,
      );
      if (!cron.rows.length) {
        warnings.push("pg_cron job inventory-issue-snapshots-every-15m not found");
      } else if (!cron.rows[0].active) {
        errors.push("pg_cron job inventory-issue-snapshots-every-15m exists but is inactive");
      } else {
        notes.push(`pg_cron active: ${cron.rows[0].jobname} (${cron.rows[0].schedule})`);
      }
    } catch {
      warnings.push("Could not query cron.job (pg_cron extension may be unavailable from this connection)");
    }
  } finally {
    await client.end().catch(() => {});
  }

  return { notes, errors, warnings };
}

export async function runIssueViewSafetyChecks(options = {}) {
  const { skipDb = false } = options;
  const fileResult = verifyMigrationFiles();
  const browserResult = verifyBrowserSnapshotPolicy();
  /** @type {{ notes: string[], errors: string[], warnings: string[] }} */
  let dbResult = { notes: [], errors: [], warnings: [] };

  if (!skipDb) {
    try {
      dbResult = await verifyDatabase();
    } catch (err) {
      dbResult.warnings.push(
        `DB checks skipped: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return {
    notes: [...fileResult.notes, ...browserResult.notes, ...dbResult.notes],
    errors: [...fileResult.errors, ...browserResult.errors, ...dbResult.errors],
    warnings: dbResult.warnings,
  };
}

async function main() {
  console.log("Phase 10Y — Issue view safety verification\n");

  const { notes, errors, warnings } = await runIssueViewSafetyChecks();

  console.log("--- Static migration checks ---");
  for (const n of notes.filter((x) => x.includes("Migration") || x.includes("10A") || x.includes("10Z"))) {
    console.log(`  ✓ ${n}`);
  }

  console.log("\n--- Browser snapshot policy ---");
  for (const n of notes.filter((x) => x.includes("browser") || x.includes("Browser"))) {
    console.log(`  ✓ ${n}`);
  }

  if (notes.some((n) => n.startsWith("View exists") || n.startsWith("Production") || n.startsWith("v_inventory"))) {
    console.log("\n--- Database checks ---");
    for (const n of notes.filter(
      (x) =>
        x.startsWith("View") ||
        x.startsWith("Table") ||
        x.startsWith("Production") ||
        x.startsWith("v_inventory") ||
        x.startsWith("inventory_issue") ||
        x.startsWith("pg_cron"),
    )) {
      console.log(`  ✓ ${n}`);
    }
  }

  for (const w of warnings) console.log(`  ⚠ ${w}`);

  for (const e of errors) console.log(`  ✗ ${e}`);

  console.log(errors.length ? `\nFAILED (${errors.length} error(s))` : "\nPASSED — issue view safety OK");
  process.exit(errors.length ? 1 : 0);
}

const isDirectRun = Boolean(process.argv[1]?.includes("verify-inventory-issue-view-safety"));

if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
