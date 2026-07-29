#!/usr/bin/env node
/**
 * Shared helpers for KK security verification scripts (Phases 1–5).
 */
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { getPoolerConnectionString } from "../supabase/dbConnect.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(__dirname, "..", "..");

export function loadEnv() {
  const env = {};
  const path = join(ROOT, ".env");
  if (!existsSync(path)) return env;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i > 0) env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return env;
}

export function applyEnv(env) {
  for (const [k, v] of Object.entries(env)) {
    if (!process.env[k]) process.env[k] = v;
  }
}

export async function connectPg() {
  applyEnv(loadEnv());
  const client = new pg.Client({
    connectionString: getPoolerConnectionString(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  return client;
}

export function getSupabaseUrl(env = loadEnv()) {
  return env.SUPABASE_URL || process.env.SUPABASE_URL || "https://yxdzvzscufkvewecvagq.supabase.co";
}

export function getAnonKey(env = loadEnv()) {
  return env.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
}

export function getServiceKey(env = loadEnv()) {
  return env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
}

export function anonClient(env = loadEnv()) {
  const url = getSupabaseUrl(env);
  const key = getAnonKey(env);
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_ANON_KEY");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export function serviceClient(env = loadEnv()) {
  const url = getSupabaseUrl(env);
  const key = getServiceKey(env);
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function rpcAsAnon(fn, args = {}) {
  const sb = anonClient();
  return sb.rpc(fn, args);
}

export async function selectAsAnon(tableOrView, columns = "*", limit = 1) {
  const sb = anonClient();
  return sb.from(tableOrView).select(columns).limit(limit);
}

export function expectDenied(result, label) {
  if (!result?.error) {
    throw new Error(`${label}: expected denial, got success`);
  }
  return `${label}: denied (${result.error.code || result.error.message})`;
}

export function expectAllowed(result, label) {
  if (result?.error) {
    throw new Error(`${label}: expected success, got ${result.error.message}`);
  }
  return `${label}: allowed`;
}

export function normalizePolicyRoles(roles) {
  if (!roles) return [];
  if (Array.isArray(roles)) return roles;
  if (typeof roles === "string") {
    return roles.replace(/[{}]/g, "").split(",").map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

export async function querySecurityDefinerFunctions(client) {
  const { rows } = await client.query(`
    SELECT
      p.oid,
      n.nspname AS schema_name,
      p.proname AS function_name,
      pg_get_function_identity_arguments(p.oid) AS args,
      has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_execute,
      p.prosecdef AS security_definer
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
    ORDER BY p.proname, pg_get_function_identity_arguments(p.oid)
  `);
  return rows;
}

export async function queryPublicViewsSecurityInvoker(client) {
  const { rows } = await client.query(`
    SELECT
      c.relname AS view_name,
      COALESCE(
        (SELECT option_value::boolean
         FROM pg_options_to_table(c.reloptions)
         WHERE option_name = 'security_invoker'),
        false
      ) AS security_invoker
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'v'
    ORDER BY c.relname
  `);
  return rows;
}

export async function queryTablesWithoutRls(client) {
  const { rows } = await client.query(`
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND NOT c.relrowsecurity
    ORDER BY c.relname
  `);
  return rows;
}

export async function queryPermissiveWritePolicies(client) {
  const { rows } = await client.query(`
    SELECT
      n.nspname AS schema_name,
      c.relname AS table_name,
      pol.polname AS policy_name,
      pol.polcmd AS command,
      pg_get_expr(pol.polqual, pol.polrelid) AS using_expr,
      pg_get_expr(pol.polwithcheck, pol.polrelid) AS with_check_expr,
      (SELECT array_agg(r.rolname)
       FROM pg_roles r
       WHERE r.oid = ANY(pol.polroles)) AS roles
    FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND pol.polcmd IN ('a', 'w', 'd', '*')
      AND (
        pg_get_expr(pol.polqual, pol.polrelid) = 'true'
        OR pg_get_expr(pol.polwithcheck, pol.polrelid) = 'true'
      )
    ORDER BY c.relname, pol.polname
  `);
  return rows;
}

export async function queryMutableSearchPathFunctions(client) {
  const { rows } = await client.query(`
    SELECT
      n.nspname AS schema_name,
      p.proname AS function_name,
      pg_get_function_identity_arguments(p.oid) AS args,
      p.proconfig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND p.proname NOT LIKE 'citext%'
      AND pg_get_function_identity_arguments(p.oid) NOT LIKE '%citext%'
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) cfg
        WHERE cfg LIKE 'search_path=%'
      )
    ORDER BY p.proname
  `);
  return rows;
}

export function printReport(title, notes, errors) {
  console.log(`\n=== ${title} ===\n`);
  for (const n of notes) console.log(`  ✓ ${n}`);
  for (const e of errors) console.log(`  ✗ ${e}`);
  console.log(`\n${errors.length ? "FAILED" : "PASSED"} (${notes.length} checks, ${errors.length} errors)\n`);
  return errors.length === 0;
}
