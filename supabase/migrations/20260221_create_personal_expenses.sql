-- Create personal_expenses table for personal budget tracking
-- This is separate from the business "expenses" table

CREATE TABLE IF NOT EXISTS personal_expenses (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  expense_date  date NOT NULL,
  description   text NOT NULL,
  category      text NOT NULL DEFAULT 'other',
  amount_cents  integer NOT NULL DEFAULT 0,
  source        text DEFAULT 'Checking',  -- Checking, Credit Card, Cash, Venmo, Other
  notes         text,
  created_at    timestamptz DEFAULT now()
);

-- Index for fast date range queries
CREATE INDEX IF NOT EXISTS idx_personal_expenses_date ON personal_expenses (expense_date);
CREATE INDEX IF NOT EXISTS idx_personal_expenses_category ON personal_expenses (category);

-- Enable RLS but allow service-role full access
ALTER TABLE personal_expenses ENABLE ROW LEVEL SECURITY;

-- Policy: anon can read (for the admin page)
CREATE POLICY "personal_expenses_anon_read"
  ON personal_expenses FOR SELECT
  TO anon USING (true);

-- Policy: anon can insert
CREATE POLICY "personal_expenses_anon_insert"
  ON personal_expenses FOR INSERT
  TO anon WITH CHECK (true);

-- Policy: anon can update
CREATE POLICY "personal_expenses_anon_update"
  ON personal_expenses FOR UPDATE
  TO anon USING (true) WITH CHECK (true);

-- Policy: anon can delete
CREATE POLICY "personal_expenses_anon_delete"
  ON personal_expenses FOR DELETE
  TO anon USING (true);
