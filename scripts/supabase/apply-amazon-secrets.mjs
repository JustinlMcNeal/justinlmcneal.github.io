#!/usr/bin/env node
/**
 * Push Amazon edge-function secrets to Supabase.
 *
 * Usage:
 *   $env:AMAZON_LWA_CLIENT_ID="..."
 *   $env:AMAZON_LWA_CLIENT_SECRET="..."
 *   node scripts/supabase/apply-amazon-secrets.mjs
 *
 * Optional overrides:
 *   AMAZON_APP_ID, AMAZON_AUTH_REDIRECT_URI, AMAZON_SP_API_REGION,
 *   AMAZON_DEFAULT_MARKETPLACE_ID
 */

import { spawnSync } from "node:child_process";

const DEFAULTS = {
  AMAZON_APP_ID: "amzn1.sp.solution.47a2d70f-8f9e-475f-bb46-3bc019582bfa",
  AMAZON_AUTH_REDIRECT_URI:
    "https://yxdzvzscufkvewecvagq.supabase.co/functions/v1/amazon-auth-callback",
  AMAZON_SP_API_REGION: "na",
  AMAZON_DEFAULT_MARKETPLACE_ID: "ATVPDKIKX0DER",
};

/** @type {Record<string, string>} */
const secrets = { ...DEFAULTS };

for (const key of ["AMAZON_LWA_CLIENT_ID", "AMAZON_LWA_CLIENT_SECRET"]) {
  const value = process.env[key]?.trim();
  if (value) secrets[key] = value;
}

for (const key of Object.keys(DEFAULTS)) {
  const override = process.env[key]?.trim();
  if (override) secrets[key] = override;
}

const missing = ["AMAZON_LWA_CLIENT_ID", "AMAZON_LWA_CLIENT_SECRET"].filter(
  (key) => !secrets[key],
);

if (missing.length > 0) {
  console.error(
    `Missing required env vars: ${missing.join(", ")}\n` +
      "Set them in PowerShell before running this script.",
  );
  process.exit(1);
}

for (const [key, value] of Object.entries(secrets)) {
  process.stdout.write(`Setting ${key} ... `);
  const result = spawnSync("supabase", ["secrets", "set", `${key}=${value}`], {
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
  });
  if (result.status !== 0) {
    console.log("failed");
    console.error(result.stderr?.toString() || result.stdout?.toString());
    process.exit(result.status || 1);
  }
  console.log("ok");
}

console.log("\nAmazon secrets applied.");
