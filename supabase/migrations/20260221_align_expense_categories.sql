-- Migration: Align expense categories with IRS 1065 / Schedule C lines
-- Run this in the Supabase Dashboard SQL Editor:
-- https://supabase.com/dashboard/project/yxdzvzscufkvewecvagq/sql/new
--
-- NOTE: This was already applied to production on 2026-02-21 via the
-- _migrate-categories.mjs script. This file documents what was done.

-- ═══════════════════════════════════════════════════
-- 1. Rename generic categories to IRS-aligned names
-- ═══════════════════════════════════════════════════

-- "Marketing" → "Advertising" (IRS Line 8)
UPDATE expenses SET category = 'Advertising', updated_at = now()
WHERE category = 'Marketing';

-- "Operation" → "Website / Hosting"
UPDATE expenses SET category = 'Website / Hosting', updated_at = now()
WHERE category = 'Operation';

-- "Food" → "Travel / Meals" (IRS Line 24)
UPDATE expenses SET category = 'Travel / Meals', updated_at = now()
WHERE category = 'Food';

-- "Vehicle Maintenance" → "Vehicle" (IRS Line 9)
UPDATE expenses SET category = 'Vehicle', updated_at = now()
WHERE category = 'Vehicle Maintenance';


-- ═══════════════════════════════════════════════════
-- 2. Recategorize mixed "Supplies" items
--    (Shipping Tools stay as "Supplies" → COGS Materials)
-- ═══════════════════════════════════════════════════

-- Clothing purchased from Baestoa = product inventory
UPDATE expenses SET category = 'Inventory', updated_at = now()
WHERE category = 'Supplies' AND description = 'Clothing';

-- Equipment & office items
UPDATE expenses SET category = 'Office', updated_at = now()
WHERE category = 'Supplies' AND description IN ('Laptop', 'Notebooks', 'Misc Tools', 'Storage');


-- ═══════════════════════════════════════════════════
-- New category taxonomy (14 categories):
-- ═══════════════════════════════════════════════════
-- 
-- COGS (Section D):
--   Inventory           → Purchases (products bought for resale)
--   Supplies            → Materials & Supplies (packaging, shipping tools)
--
-- Expenses (Section E):
--   Advertising         → Line 8
--   Platform Fees       → - (Stripe/Amazon/Etsy processing fees)
--   Shipping            → - (Postage, labels)
--   Software            → - (Subscriptions, SaaS tools)
--   Website / Hosting   → - (Domain, hosting, GoDaddy)
--   Office              → Line 18
--   Phone / Internet    → Line 25 (business portion)
--   Travel / Meals      → Line 24 (meals 50% deductible)
--   Professional Fees   → Line 17 (CPA, legal, tax prep)
--   Bank Fees           → - (Bank/merchant fees)
--   Vehicle             → Line 9 (gas, maintenance)
--   Other               → Line 27
