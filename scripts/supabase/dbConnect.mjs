#!/usr/bin/env node
/**
 * Shared Supabase Postgres connection helpers.
 *
 * Root causes of local password failures on this project:
 * 1. db.{ref}.supabase.co is IPv6-only — often ETIMEDOUT on Windows without IPv6 routing.
 * 2. Pooler must use the project region (West US / Oregon → aws-0-us-west-2), not us-east-1.
 * 3. When password auth still fails, use linked CLI: npx supabase db query --linked -f file.sql
 */

import { spawnSync } from "node:child_process";
import pg from "pg";

export const PROJECT_REF = "yxdzvzscufkvewecvagq";
export const POOLER_HOST = "aws-0-us-west-2.pooler.supabase.com";

export function getPoolerConnectionString(options = {}) {
  const {
    password = process.env.SUPABASE_DB_PASSWORD || process.env.PGPASSWORD,
    port = 5432,
    projectRef = PROJECT_REF,
  } = options;

  if (process.env.SUPABASE_DB_URL) return process.env.SUPABASE_DB_URL;
  if (!password) {
    throw new Error(
      "Set SUPABASE_DB_PASSWORD (or SUPABASE_DB_URL).\n" +
        "Dashboard → Project Settings → Database → Database password",
    );
  }

  const encoded = encodeURIComponent(password);
  return `postgresql://postgres.${projectRef}:${encoded}@${POOLER_HOST}:${port}/postgres`;
}

export async function connectPgClient(options = {}) {
  const client = new pg.Client({
    connectionString: getPoolerConnectionString(options),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  return client;
}

export function runLinkedSqlFile(filePath, repoRoot) {
  const result = spawnSync(
    "npx",
    ["supabase", "db", "query", "--linked", "-f", filePath],
    {
      cwd: repoRoot,
      encoding: "utf8",
      shell: process.platform === "win32",
    },
  );

  if (result.status !== 0) {
    const msg = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(msg || `supabase db query failed for ${filePath}`);
  }

  return result.stdout?.trim() || "";
}

export function runLinkedSql(sql, repoRoot) {
  const result = spawnSync(
    "npx",
    ["supabase", "db", "query", "--linked", sql],
    {
      cwd: repoRoot,
      encoding: "utf8",
      shell: process.platform === "win32",
    },
  );

  if (result.status !== 0) {
    const msg = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(msg || "supabase db query failed");
  }

  return result.stdout?.trim() || "";
}
