// Migrate expense categories to IRS-aligned names
const KEY = process.argv[2];
if (!KEY) { console.error("Usage: node _migrate-categories.mjs <service-role-key>"); process.exit(1); }
const BASE = "https://yxdzvzscufkvewecvagq.supabase.co/rest/v1/expenses";
const h = { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json", Prefer: "return=minimal" };

async function patch(filter, body) {
  const url = BASE + "?" + filter;
  const r = await fetch(url, { method: "PATCH", headers: h, body: JSON.stringify(body) });
  return r.status;
}

async function run() {
  // Rename whole categories
  console.log("Marketing → Advertising:", await patch("category=eq.Marketing", { category: "Advertising" }));
  console.log("Operation → Website / Hosting:", await patch("category=eq.Operation", { category: "Website / Hosting" }));
  console.log("Food → Travel / Meals:", await patch("category=eq.Food", { category: "Travel / Meals" }));
  console.log("Vehicle Maintenance → Vehicle:", await patch("category=eq.Vehicle%20Maintenance", { category: "Vehicle" }));

  // Recategorize specific Supplies items
  console.log("Clothing → Inventory:", await patch("category=eq.Supplies&description=eq.Clothing", { category: "Inventory" }));
  console.log("Laptop → Office:", await patch("category=eq.Supplies&description=eq.Laptop", { category: "Office" }));
  console.log("Notebooks → Office:", await patch("category=eq.Supplies&description=eq.Notebooks", { category: "Office" }));
  console.log("Misc Tools → Office:", await patch("category=eq.Supplies&description=eq.Misc%20Tools", { category: "Office" }));
  console.log("Storage → Office:", await patch("category=eq.Supplies&description=eq.Storage", { category: "Office" }));
  // Remaining Supplies (Shipping Tools) stay as 'Supplies' → COGS Materials

  // Verify final state
  const verify = await fetch(BASE + "?select=category,description,amount_cents&order=category", { headers: h });
  const rows = await verify.json();
  const cats = {};
  for (const r of rows) cats[r.category] = (cats[r.category] || 0) + 1;
  console.log("\nFinal categories:", JSON.stringify(cats, null, 2));
}

run().catch(e => { console.error(e); process.exit(1); });
