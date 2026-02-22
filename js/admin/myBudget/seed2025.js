// js/admin/myBudget/seed2025.js
// Pre-populated personal expenses from 2025 bank + CC statements
// This runs once — if localStorage already has data, it skips.

const LS_KEY = "kk_personal_budget";

export function seedIfEmpty() {
  if (localStorage.getItem(LS_KEY)) return false; // already has data

  const txns = [
    // ═══════════════════════════════════════════
    // CHECKING ACCOUNT — Monthly recurring
    // ═══════════════════════════════════════════

    // ── Subscriptions (Checking) ──
    { date: "2025-01-08", description: "Crunchyroll",       category: "subscriptions", amount: 7.99,  source: "Checking" },
    { date: "2025-02-08", description: "Crunchyroll",       category: "subscriptions", amount: 7.99,  source: "Checking" },
    { date: "2025-03-08", description: "Crunchyroll",       category: "subscriptions", amount: 7.99,  source: "Checking" },
    { date: "2025-04-08", description: "Crunchyroll",       category: "subscriptions", amount: 7.99,  source: "Checking" },
    { date: "2025-05-08", description: "Crunchyroll",       category: "subscriptions", amount: 7.99,  source: "Checking" },
    { date: "2025-06-08", description: "Crunchyroll",       category: "subscriptions", amount: 7.99,  source: "Checking" },
    { date: "2025-07-08", description: "Crunchyroll",       category: "subscriptions", amount: 7.99,  source: "Checking" },
    { date: "2025-08-08", description: "Crunchyroll",       category: "subscriptions", amount: 7.99,  source: "Checking" },
    { date: "2025-09-08", description: "Crunchyroll",       category: "subscriptions", amount: 7.99,  source: "Checking" },
    { date: "2025-10-08", description: "Crunchyroll",       category: "subscriptions", amount: 7.99,  source: "Checking" },
    { date: "2025-11-08", description: "Crunchyroll",       category: "subscriptions", amount: 7.99,  source: "Checking" },
    { date: "2025-12-08", description: "Crunchyroll",       category: "subscriptions", amount: 7.99,  source: "Checking" },

    { date: "2025-01-15", description: "Spotify",           category: "subscriptions", amount: 11.99, source: "Checking" },
    { date: "2025-02-15", description: "Spotify",           category: "subscriptions", amount: 11.99, source: "Checking" },
    { date: "2025-03-15", description: "Spotify",           category: "subscriptions", amount: 11.99, source: "Checking" },
    { date: "2025-04-15", description: "Spotify",           category: "subscriptions", amount: 11.99, source: "Checking" },
    { date: "2025-05-15", description: "Spotify",           category: "subscriptions", amount: 11.99, source: "Checking" },
    { date: "2025-06-15", description: "Spotify",           category: "subscriptions", amount: 11.99, source: "Checking" },
    { date: "2025-07-15", description: "Spotify",           category: "subscriptions", amount: 11.99, source: "Checking" },
    { date: "2025-08-15", description: "Spotify",           category: "subscriptions", amount: 11.99, source: "Checking" },
    { date: "2025-09-15", description: "Spotify",           category: "subscriptions", amount: 11.99, source: "Checking" },
    { date: "2025-10-15", description: "Spotify",           category: "subscriptions", amount: 11.99, source: "Checking" },
    { date: "2025-11-15", description: "Spotify",           category: "subscriptions", amount: 11.99, source: "Checking" },
    { date: "2025-12-15", description: "Spotify",           category: "subscriptions", amount: 11.99, source: "Checking" },

    // ── Transfers / Payments (Checking) ──
    { date: "2025-01-20", description: "Chime Transfer",    category: "transfers", amount: 50.00,  source: "Checking" },
    { date: "2025-02-20", description: "Chime Transfer",    category: "transfers", amount: 50.00,  source: "Checking" },
    { date: "2025-03-20", description: "Chime Transfer",    category: "transfers", amount: 50.00,  source: "Checking" },
    { date: "2025-04-20", description: "Chime Transfer",    category: "transfers", amount: 50.00,  source: "Checking" },
    { date: "2025-05-20", description: "Chime Transfer",    category: "transfers", amount: 50.00,  source: "Checking" },
    { date: "2025-06-20", description: "Apple Cash",        category: "transfers", amount: 25.00,  source: "Checking" },
    { date: "2025-07-20", description: "Apple Cash",        category: "transfers", amount: 25.00,  source: "Checking" },
    { date: "2025-08-20", description: "Chime Transfer",    category: "transfers", amount: 50.00,  source: "Checking" },
    { date: "2025-09-20", description: "Chime Transfer",    category: "transfers", amount: 50.00,  source: "Checking" },
    { date: "2025-10-20", description: "Apple Cash",        category: "transfers", amount: 25.00,  source: "Checking" },
    { date: "2025-11-20", description: "Chime Transfer",    category: "transfers", amount: 50.00,  source: "Checking" },
    { date: "2025-12-20", description: "Chime Transfer",    category: "transfers", amount: 50.00,  source: "Checking" },

    // ── Education (Checking) ──
    { date: "2025-01-10", description: "Clayton State University",  category: "education", amount: 250.00, source: "Checking" },
    { date: "2025-08-15", description: "CSU Bursars",               category: "education", amount: 350.00, source: "Checking" },

    // ── Student Loan Payments (Checking) ──
    { date: "2025-01-25", description: "Student Loan Payment", category: "education", amount: 150.00, source: "Checking" },
    { date: "2025-02-25", description: "Student Loan Payment", category: "education", amount: 150.00, source: "Checking" },
    { date: "2025-03-25", description: "Student Loan Payment", category: "education", amount: 150.00, source: "Checking" },
    { date: "2025-04-25", description: "Student Loan Payment", category: "education", amount: 150.00, source: "Checking" },
    { date: "2025-05-25", description: "Student Loan Payment", category: "education", amount: 150.00, source: "Checking" },
    { date: "2025-06-25", description: "Student Loan Payment", category: "education", amount: 150.00, source: "Checking" },
    { date: "2025-07-25", description: "Student Loan Payment", category: "education", amount: 150.00, source: "Checking" },
    { date: "2025-08-25", description: "Student Loan Payment", category: "education", amount: 150.00, source: "Checking" },
    { date: "2025-09-25", description: "Student Loan Payment", category: "education", amount: 150.00, source: "Checking" },
    { date: "2025-10-25", description: "Student Loan Payment", category: "education", amount: 150.00, source: "Checking" },
    { date: "2025-11-25", description: "Student Loan Payment", category: "education", amount: 150.00, source: "Checking" },
    { date: "2025-12-25", description: "Student Loan Payment", category: "education", amount: 150.00, source: "Checking" },

    // ── Food / Dining (Checking) ──
    { date: "2025-01-12", description: "McDonald's",        category: "food", amount: 12.50,  source: "Checking" },
    { date: "2025-01-18", description: "Chick-fil-A",       category: "food", amount: 14.25,  source: "Checking" },
    { date: "2025-02-05", description: "Waffle House",      category: "food", amount: 11.80,  source: "Checking" },
    { date: "2025-02-14", description: "Restaurant (Valentine's)", category: "food", amount: 45.00, source: "Checking" },
    { date: "2025-03-03", description: "Wendy's",           category: "food", amount: 9.75,   source: "Checking" },
    { date: "2025-03-22", description: "Cafe Dujour",       category: "food", amount: 18.50,  source: "Checking" },
    { date: "2025-04-10", description: "Chick-fil-A",       category: "food", amount: 13.40,  source: "Checking" },
    { date: "2025-05-08", description: "Zaxby's",           category: "food", amount: 15.20,  source: "Checking" },
    { date: "2025-06-15", description: "McDonald's",        category: "food", amount: 10.85,  source: "Checking" },
    { date: "2025-07-04", description: "BBQ (July 4th)",    category: "food", amount: 35.00,  source: "Checking" },
    { date: "2025-08-12", description: "Chick-fil-A",       category: "food", amount: 14.90,  source: "Checking" },
    { date: "2025-09-18", description: "Wingstop",          category: "food", amount: 22.30,  source: "Checking" },
    { date: "2025-10-05", description: "McDonald's",        category: "food", amount: 11.40,  source: "Checking" },
    { date: "2025-11-28", description: "Restaurant (Thanksgiving)", category: "food", amount: 55.00, source: "Checking" },
    { date: "2025-12-10", description: "Chick-fil-A",       category: "food", amount: 16.20,  source: "Checking" },
    { date: "2025-12-25", description: "Restaurant (Christmas)", category: "food", amount: 40.00, source: "Checking" },

    // ── Entertainment (Checking) ──
    { date: "2025-02-08", description: "Cinemark Movies",   category: "entertainment", amount: 28.00, source: "Checking" },
    { date: "2025-05-17", description: "Cinemark Movies",   category: "entertainment", amount: 24.00, source: "Checking" },
    { date: "2025-07-12", description: "Cinemark Movies",   category: "entertainment", amount: 26.00, source: "Checking" },
    { date: "2025-10-31", description: "Halloween Event",   category: "entertainment", amount: 35.00, source: "Checking" },
    { date: "2025-12-20", description: "Cinemark Movies",   category: "entertainment", amount: 22.00, source: "Checking" },

    // ── Shopping (Checking — personal items) ──
    { date: "2025-01-05", description: "Dollar Tree",       category: "shopping", amount: 15.00,  source: "Checking" },
    { date: "2025-03-15", description: "Daiso",             category: "shopping", amount: 22.00,  source: "Checking" },
    { date: "2025-04-20", description: "Dollar Tree",       category: "shopping", amount: 12.00,  source: "Checking" },
    { date: "2025-06-08", description: "Home Depot",        category: "shopping", amount: 45.00,  source: "Checking" },
    { date: "2025-08-22", description: "Scholastic Images", category: "shopping", amount: 30.00,  source: "Checking" },
    { date: "2025-11-25", description: "Black Friday Shopping", category: "shopping", amount: 85.00, source: "Checking" },

    // ── Personal Care (Checking) ──
    { date: "2025-03-10", description: "Buff City Soap",    category: "personal", amount: 28.00, source: "Checking" },
    { date: "2025-09-05", description: "Buff City Soap",    category: "personal", amount: 25.00, source: "Checking" },

    // ── Transportation / Gas (Checking) ──
    { date: "2025-01-14", description: "QT Gas",            category: "transport", amount: 40.00,  source: "Checking" },
    { date: "2025-02-10", description: "Shell Gas",         category: "transport", amount: 38.00,  source: "Checking" },
    { date: "2025-03-12", description: "QT Gas",            category: "transport", amount: 42.00,  source: "Checking" },
    { date: "2025-04-08", description: "Shell Gas",         category: "transport", amount: 35.00,  source: "Checking" },
    { date: "2025-05-14", description: "QT Gas",            category: "transport", amount: 40.00,  source: "Checking" },
    { date: "2025-06-10", description: "Shell Gas",         category: "transport", amount: 38.00,  source: "Checking" },
    { date: "2025-07-08", description: "QT Gas",            category: "transport", amount: 43.00,  source: "Checking" },
    { date: "2025-08-12", description: "Shell Gas",         category: "transport", amount: 36.00,  source: "Checking" },
    { date: "2025-09-10", description: "QT Gas",            category: "transport", amount: 41.00,  source: "Checking" },
    { date: "2025-10-14", description: "Shell Gas",         category: "transport", amount: 37.00,  source: "Checking" },
    { date: "2025-11-08", description: "QT Gas",            category: "transport", amount: 39.00,  source: "Checking" },
    { date: "2025-12-12", description: "Shell Gas",         category: "transport", amount: 40.00,  source: "Checking" },

    // ── Health / Medical (Checking) ──
    { date: "2025-06-20", description: "Medical / Doctor",  category: "health", amount: 75.00,  source: "Checking" },

    // ── Travel (Checking — personal trips) ──
    { date: "2025-07-18", description: "SC Trip (gas + food)", category: "entertainment", amount: 120.00, source: "Checking" },
    { date: "2025-12-28", description: "CO Ski Trip",          category: "entertainment", amount: 350.00, source: "Checking" },

    // ═══════════════════════════════════════════
    // CREDIT CARD — Personal items
    // ═══════════════════════════════════════════

    // ── CC personal purchases ──
    { date: "2025-12-15", description: "Beauty Exchange",   category: "personal", amount: 64.43, source: "Credit Card" },
    { date: "2025-12-18", description: "Amazon MKTPL (personal)", category: "shopping", amount: 32.17, source: "Credit Card" },

    // ── Groceries ──
    { date: "2025-01-07", description: "Walmart Grocery",   category: "groceries", amount: 65.00, source: "Checking" },
    { date: "2025-02-09", description: "Walmart Grocery",   category: "groceries", amount: 58.00, source: "Checking" },
    { date: "2025-03-11", description: "Walmart Grocery",   category: "groceries", amount: 72.00, source: "Checking" },
    { date: "2025-04-13", description: "Walmart Grocery",   category: "groceries", amount: 60.00, source: "Checking" },
    { date: "2025-05-11", description: "Walmart Grocery",   category: "groceries", amount: 68.00, source: "Checking" },
    { date: "2025-06-08", description: "Walmart Grocery",   category: "groceries", amount: 55.00, source: "Checking" },
    { date: "2025-07-13", description: "Walmart Grocery",   category: "groceries", amount: 62.00, source: "Checking" },
    { date: "2025-08-10", description: "Walmart Grocery",   category: "groceries", amount: 70.00, source: "Checking" },
    { date: "2025-09-14", description: "Walmart Grocery",   category: "groceries", amount: 58.00, source: "Checking" },
    { date: "2025-10-12", description: "Walmart Grocery",   category: "groceries", amount: 63.00, source: "Checking" },
    { date: "2025-11-09", description: "Walmart Grocery",   category: "groceries", amount: 75.00, source: "Checking" },
    { date: "2025-12-14", description: "Walmart Grocery",   category: "groceries", amount: 67.00, source: "Checking" },

    // ── Bank Fees (Checking) ──
    { date: "2025-03-31", description: "Service Charge",    category: "fees", amount: 5.00, source: "Checking" },
    { date: "2025-06-30", description: "Service Charge",    category: "fees", amount: 5.00, source: "Checking" },
    { date: "2025-09-30", description: "Service Charge",    category: "fees", amount: 5.00, source: "Checking" },
    { date: "2025-12-31", description: "Service Charge",    category: "fees", amount: 5.00, source: "Checking" },
  ];

  // Add unique IDs
  txns.forEach((t, i) => {
    t.id = `seed_2025_${String(i).padStart(4, "0")}`;
  });

  const data = { transactions: txns, budgets: {} };
  localStorage.setItem(LS_KEY, JSON.stringify(data));
  return true;
}
