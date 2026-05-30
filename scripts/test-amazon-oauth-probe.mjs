#!/usr/bin/env node
/** Probe Amazon OAuth setup without Amazon login credentials. */
const APP_ID = "amzn1.sp.solution.47a2d70f-8f9e-475f-bb46-3bc019582bfa";
const CONSENT_BETA =
  `https://sellercentral.amazon.com/apps/authorize/consent?application_id=${APP_ID}&state=probe-test&version=beta`;
const CONSENT_PROD =
  `https://sellercentral.amazon.com/apps/authorize/consent?application_id=${APP_ID}&state=probe-test`;
const PAGE = "https://karrykraze.com/pages/admin/amazon.html";

async function probe(name, url, opts = {}) {
  try {
    const resp = await fetch(url, { redirect: "manual", ...opts });
    const text = await resp.text();
    const hasMd1000 = /MD1000|Unable to find application/i.test(text);
    const hasSignIn = /Sign in|Sign-In/i.test(text);
    console.log(`\n[${name}] ${resp.status} ${resp.headers.get("location") || ""}`);
    console.log(`  MD1000 in body: ${hasMd1000}`);
    console.log(`  Sign-in page: ${hasSignIn}`);
    if (hasMd1000) console.log("  -> Amazon rejected app lookup at this URL");
  } catch (err) {
    console.log(`\n[${name}] ERROR`, err.message);
  }
}

console.log("Amazon OAuth probe (no Amazon login — limited signal)");
await probe("karrykraze admin page", PAGE);
await probe("consent draft (version=beta)", CONSENT_BETA, {
  headers: { "User-Agent": "Mozilla/5.0 (compatible; KK-OAuth-Probe/1.0)" },
});
await probe("consent production (no beta)", CONSENT_PROD, {
  headers: { "User-Agent": "Mozilla/5.0 (compatible; KK-OAuth-Probe/1.0)" },
});
