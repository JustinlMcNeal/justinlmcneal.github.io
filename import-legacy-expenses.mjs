// import-legacy-expenses.mjs
// Usage: node import-legacy-expenses.mjs "<SERVICE_ROLE_KEY>"
//
// Creates the expenses table (if needed) and imports 20 legacy rows from CSV data.

const SUPABASE_URL = "https://yxdzvzscufkvewecvagq.supabase.co";
const SERVICE_KEY  = process.argv[2];

if (!SERVICE_KEY) {
  console.error("Usage: node import-legacy-expenses.mjs <SERVICE_ROLE_KEY>");
  process.exit(1);
}

const headers = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=minimal"
};

async function rpc(sql) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql })
  });
  if (!r.ok) {
    // rpc might not exist — that's fine, we'll use the REST API
  }
}

async function post(table, rows) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify(rows)
  });
  const body = await r.json();
  if (!r.ok) throw new Error(`Insert failed: ${JSON.stringify(body)}`);
  return body;
}

async function query(table, params = "") {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
    headers
  });
  return r.json();
}

// ── Legacy CSV data (20 rows from the first "Exspenses" column) ──
const RAW = [
  { date: "2025-03-10", category: "Inventory",            description: "KKH_0001",            amount: 157.80, vendor: "Baestoa" },
  { date: "2025-03-22", category: "Inventory",            description: "KKH_0002",            amount: 424.38, vendor: "Baestoa" },
  { date: "2025-04-17", category: "Supplies",             description: "Shipping Tools",      amount:  58.76, vendor: "Office Depot" },
  { date: "2025-04-17", category: "Vehicle Maintenance",  description: "Gas",                 amount:  34.88, vendor: "Shell" },
  { date: "2025-04-18", category: "Inventory",            description: "KKH_0003",            amount: 342.70, vendor: "Baestoa" },
  { date: "2025-04-18", category: "Supplies",             description: "Shipping Tools",      amount:  78.52, vendor: "Walmart" },
  { date: "2025-04-18", category: "Supplies",             description: "Clothing",            amount: 120.00, vendor: "Baestoa" },
  { date: "2025-04-18", category: "Operation",            description: "Email Support",       amount:  23.88, vendor: "GoDaddy" },
  { date: "2025-04-18", category: "Food",                 description: "Food",                amount:  10.79, vendor: "Waffle House" },
  { date: "2025-04-28", category: "Vehicle Maintenance",  description: "Gas",                 amount:  33.00, vendor: "Shell" },
  { date: "2025-05-13", category: "Vehicle Maintenance",  description: "Gas",                 amount:  40.00, vendor: "Shell" },
  { date: "2025-05-13", category: "Marketing",            description: "AI Video Generator",  amount:  15.00, vendor: "Runway" },
  { date: "2025-04-30", category: "Marketing",            description: "Etsy",                amount:  13.49, vendor: "Etsy" },
  { date: "2025-05-18", category: "Marketing",            description: "AI Video Generator",  amount:  10.00, vendor: "Runway" },
  { date: "2025-05-22", category: "Inventory",            description: "Item Testing",        amount:  20.00, vendor: "Baestoa" },
  { date: "2025-08-11", category: "Supplies",             description: "Laptop",              amount:  80.00, vendor: "Office Depot" },
  { date: "2025-08-11", category: "Supplies",             description: "Notebooks",           amount:  10.00, vendor: "Office Depot" },
  { date: "2025-08-11", category: "Supplies",             description: "Misc Tools",          amount:  80.00, vendor: "Amazon" },
  { date: "2025-08-11", category: "Supplies",             description: "Storage",             amount:   8.00, vendor: "Office Depot" },
  { date: "2025-08-11", category: "Supplies",             description: "Storage",             amount:   8.76, vendor: "Office Depot" },
];

async function main() {
  console.log("=== Legacy Expenses Import ===\n");

  // 1. Check if table exists by trying to query it
  console.log("1. Checking if expenses table exists...");
  const check = await fetch(`${SUPABASE_URL}/rest/v1/expenses?select=id&limit=1`, { headers });
  
  if (!check.ok) {
    console.log("\n⚠️  The 'expenses' table does not exist yet.");
    console.log("   Please create it first by running this SQL in the Supabase SQL Editor:\n");
    console.log(`
CREATE TABLE IF NOT EXISTS expenses (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  expense_date  DATE NOT NULL,
  category      TEXT NOT NULL,
  description   TEXT,
  amount_cents  INTEGER NOT NULL DEFAULT 0,
  vendor        TEXT,
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- Index for common queries
CREATE INDEX IF NOT EXISTS idx_expenses_date     ON expenses (expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses (category);

-- RLS: allow authenticated users full access
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read expenses"
  ON expenses FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert expenses"
  ON expenses FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update expenses"
  ON expenses FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete expenses"
  ON expenses FOR DELETE
  TO authenticated
  USING (true);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_expenses_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_expenses_updated_at
  BEFORE UPDATE ON expenses
  FOR EACH ROW
  EXECUTE FUNCTION update_expenses_updated_at();
`);
    console.log("\nThen re-run this script.");
    process.exit(1);
  }

  // Check if we already imported
  const existing = await query("expenses", "select=id&limit=1");
  if (Array.isArray(existing) && existing.length > 0) {
    console.log(`   Table already has ${existing.length}+ rows. Checking count...`);
    const countResp = await fetch(`${SUPABASE_URL}/rest/v1/expenses?select=count`, {
      headers: { ...headers, Prefer: "count=exact" }
    });
    const range = countResp.headers.get("content-range");
    console.log(`   Content-Range: ${range}`);
    
    const match = range?.match(/\/(\d+)/);
    const total = match ? parseInt(match[1]) : 0;
    if (total >= 20) {
      console.log(`   Already have ${total} rows — skipping import to avoid duplicates.`);
      console.log("   If you want to re-import, delete all rows first.");
      process.exit(0);
    }
    console.log(`   Only ${total} rows — proceeding with import.`);
  }

  // 2. Insert rows
  console.log("\n2. Inserting 20 legacy expenses...");
  
  const rows = RAW.map(r => ({
    expense_date: r.date,
    category: r.category,
    description: r.description,
    amount_cents: Math.round(r.amount * 100),
    vendor: r.vendor,
    notes: "Imported from legacy Google Sheets"
  }));

  const inserted = await post("expenses", rows);
  console.log(`   ✅ Inserted ${inserted.length} rows.`);

  // 3. Summary
  const total = rows.reduce((s, r) => s + r.amount_cents, 0);
  console.log(`\n=== Summary ===`);
  console.log(`   Rows imported: ${inserted.length}`);
  console.log(`   Total amount:  $${(total / 100).toFixed(2)}`);
  
  // Category breakdown
  const cats = {};
  for (const r of rows) {
    cats[r.category] = (cats[r.category] || 0) + r.amount_cents;
  }
  console.log(`\n   Category breakdown:`);
  for (const [cat, cents] of Object.entries(cats).sort((a, b) => b[1] - a[1])) {
    console.log(`     ${cat.padEnd(22)} $${(cents / 100).toFixed(2)}`);
  }

  console.log("\n✅ Done!");
}

main().catch(err => { console.error(err); process.exit(1); });
