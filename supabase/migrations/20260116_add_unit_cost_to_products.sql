-- Add unit_cost column to products table for profit calculations
-- This allows tracking the cost of each product for margin/profit analysis

ALTER TABLE products ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(10,2);

-- Add comment for documentation
COMMENT ON COLUMN products.unit_cost IS 'Cost per unit in USD for profit margin calculations';
