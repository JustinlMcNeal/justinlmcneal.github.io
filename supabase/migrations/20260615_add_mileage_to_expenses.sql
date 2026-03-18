-- Add mileage tracking columns to the expenses table.
-- Run in Supabase Dashboard SQL Editor:
-- https://supabase.com/dashboard/project/yxdzvzscufkvewecvagq/sql/new

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS miles NUMERIC;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS mileage_rate NUMERIC;

-- miles       = total miles driven for this trip
-- mileage_rate = cents-per-mile (e.g. 70 = $0.70/mile, 2025 IRS standard rate)
-- When category = 'Mileage', amount_cents = ROUND(miles * mileage_rate)

COMMENT ON COLUMN expenses.miles IS 'Miles driven for this trip (mileage entries only)';
COMMENT ON COLUMN expenses.mileage_rate IS 'Rate in cents per mile used for calculation (e.g. 70 = $0.70)';
