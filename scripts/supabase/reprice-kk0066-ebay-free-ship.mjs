#!/usr/bin/env node
/**
 * KK_0066 8-Ball: eBay $12.99 free shipping, Best Offer auto-accept $10.99 / auto-decline $9.99.
 * Uses the free-shipping fulfillment policy already on KK-0013's offer.
 *
 * Usage: node scripts/supabase/reprice-kk0066-ebay-free-ship.mjs [--apply]
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { connectPgClient } from "./dbConnect.mjs";

const APPLY = process.argv.includes("--apply");
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const TARGET = { code: "KK_0066", sku: "KK_0066", offerId: "170245369011", listingId: "377194469550", priceCents: 1299 };
const REFERENCE_SKU = "KK-0013";

for (const line of readFileSync(join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
  if (!m) continue;
  const val = m[2].replace(/^["']|["']$/g, "").trim();
  if (val && (!process.env[m[1]] || !String(process.env[m[1]]).trim())) process.env[m[1]] = val;
}
const env = process.env;

const db = await connectPgClient();
const { rows: [admin] } = await db.query(`
  SELECT email FROM auth.users
  WHERE COALESCE((raw_app_meta_data->>'is_admin')::boolean, false) = true
  ORDER BY created_at LIMIT 1`);
const sbAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const { data: link, error } = await sbAdmin.auth.admin.generateLink({ type: "magiclink", email: admin.email });
if (error) throw error;
const anon = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const { data: session, error: vErr } = await anon.auth.verifyOtp({
  token_hash: link.properties.hashed_token,
  type: "magiclink",
});
if (vErr) throw vErr;
const token = session.session.access_token;

async function callFn(body) {
  const resp = await fetch(`${env.SUPABASE_URL}/functions/v1/ebay-manage-listing`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, apikey: env.SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: resp.status, data: await resp.json().catch(() => ({})) };
}

async function getOffer(sku, offerId) {
  const r = await callFn({ action: "get_offers", sku });
  const list = r.data?.offers || r.data?.data?.offers || [];
  return (Array.isArray(list) ? list : []).find((o) => !offerId || String(o.offerId) === String(offerId)) || null;
}

const summarize = (o) => ({
  sku: o?.sku,
  offerId: o?.offerId,
  price: o?.pricingSummary?.price?.value,
  fulfillmentPolicyId: o?.listingPolicies?.fulfillmentPolicyId,
  bestOffer: o?.listingPolicies?.bestOfferTerms,
  status: o?.status,
});

const policies = await callFn({ action: "get_policies" });
const fulfillment =
  policies.data?.policies?.fulfillment_policy?.fulfillmentPolicies ||
  policies.data?.policies?.fulfillment_policy?.policies ||
  [];
const describe = (p) => ({
  id: p.fulfillmentPolicyId,
  name: p.name,
  domestic: (p.shippingOptions || [])
    .filter((o) => String(o.optionType).toUpperCase() === "DOMESTIC")
    .flatMap((o) => (o.shippingServices || []).map((s) => ({
      code: s.shippingServiceCode,
      free: s.freeShipping === true,
      cost: s.shippingCost?.value,
    }))),
});
console.log("Fulfillment policies:", JSON.stringify(fulfillment.map(describe), null, 2));

const ref = await getOffer(REFERENCE_SKU);
const current = await getOffer(TARGET.sku, TARGET.offerId);
console.log("\nReference KK-0013 offer:", summarize(ref));
console.log("Current 8-Ball offer:", summarize(current));

const refPolicyId = ref?.listingPolicies?.fulfillmentPolicyId;
const refPolicy = fulfillment.find((p) => String(p.fulfillmentPolicyId) === String(refPolicyId));
const isFree = (p) => describe(p).domestic.some((s) => s.free || Number(s.cost) === 0);
const freePolicyId =
  (refPolicy && isFree(refPolicy) ? refPolicyId : null) ||
  fulfillment.find(isFree)?.fulfillmentPolicyId ||
  null;
if (!freePolicyId) throw new Error("No free-shipping fulfillment policy found");
console.log("\nFree-shipping policy to use:", describe(fulfillment.find((p) => String(p.fulfillmentPolicyId) === String(freePolicyId))));

const BEST_OFFER = { bestOfferEnabled: true, autoAcceptPrice: "10.99", autoDeclinePrice: "9.99" };

if (!APPLY) {
  console.log("\n[dry-run] would set", TARGET.sku, "to $12.99, policy", freePolicyId, "best offer", BEST_OFFER);
  await db.end();
  process.exit(0);
}

const upd = await callFn({
  action: "update_offer",
  offerId: TARGET.offerId,
  sku: TARGET.sku,
  expectedSku: TARGET.sku,
  listingId: TARGET.listingId,
  priceCents: TARGET.priceCents,
  policies: { fulfillmentPolicyId: freePolicyId },
  bestOfferTerms: BEST_OFFER,
});
console.log("\nupdate_offer", upd.status, JSON.stringify(upd.data).slice(0, 1200));
if (!upd.data?.success) {
  await db.end();
  process.exit(1);
}

const after = await getOffer(TARGET.sku, TARGET.offerId);
console.log("\nAfter:", summarize(after));
if (after?.pricingSummary?.price?.value !== "12.99") throw new Error("Price did not verify at 12.99");
if (after?.listingPolicies?.bestOfferTerms?.autoAcceptPrice?.value !== "10.99") {
  throw new Error("Best Offer auto-accept did not verify at 10.99");
}

const { rows } = await db.query(
  `UPDATE products SET ebay_price_cents = $1, updated_at = now() WHERE code = $2
   RETURNING code, price, ebay_price_cents`,
  [TARGET.priceCents, TARGET.code]
);
console.log(rows[0]);
await db.end();
