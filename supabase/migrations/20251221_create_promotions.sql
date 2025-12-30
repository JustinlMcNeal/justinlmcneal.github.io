-- Create promotions table
CREATE TABLE IF NOT EXISTS public.promotions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  
  -- Basic info
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  description TEXT,
  
  -- Promotion type and value
  type VARCHAR(50) NOT NULL CHECK (type IN ('percentage', 'fixed', 'bogo', 'free-shipping')),
  value NUMERIC(10, 2) NOT NULL DEFAULT 0,
  
  -- Scope (what items the promo applies to)
  scope_type VARCHAR(50) NOT NULL DEFAULT 'all' CHECK (scope_type IN ('all', 'category', 'tag', 'product')),
  scope_data UUID[] DEFAULT '{}', -- Array of category/tag/product IDs
  
  -- BOGO specific (for type='bogo')
  bogo_reward_type VARCHAR(50) DEFAULT 'product' CHECK (bogo_reward_type IS NULL OR bogo_reward_type IN ('product', 'category', 'tag')),
  bogo_reward_id UUID, -- Product, category, or tag ID to give free
  
  -- Restrictions
  min_order_amount NUMERIC(10, 2) DEFAULT 0,
  usage_limit INTEGER, -- NULL = unlimited
  usage_count INTEGER DEFAULT 0,
  
  -- Dates
  start_date TIMESTAMP WITH TIME ZONE,
  end_date TIMESTAMP WITH TIME ZONE,
  
  -- Status
  is_active BOOLEAN DEFAULT true,
  is_public BOOLEAN DEFAULT true, -- Show to customers
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  
  CONSTRAINT valid_value CHECK (value >= 0),
  CONSTRAINT valid_dates CHECK (start_date IS NULL OR end_date IS NULL OR start_date <= end_date)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_promotions_active ON public.promotions(is_active, is_public);
CREATE INDEX IF NOT EXISTS idx_promotions_dates ON public.promotions(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_promotions_code ON public.promotions(code);
CREATE INDEX IF NOT EXISTS idx_promotions_scope ON public.promotions(scope_type);

-- Enable RLS (Row Level Security)
ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;

-- Drop old policies if they exist
DROP POLICY IF EXISTS "public_can_read_active_promotions" ON public.promotions;
DROP POLICY IF EXISTS "admin_can_manage_promotions" ON public.promotions;

-- RLS Policies
-- Allow anyone to read active public promotions
CREATE POLICY "public_read_active_promotions"
  ON public.promotions
  FOR SELECT
  TO public
  USING (is_public = true AND is_active = true);

-- Allow authenticated users to manage promotions
CREATE POLICY "authenticated_manage_promotions"
  ON public.promotions
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Grant permissions
GRANT SELECT ON public.promotions TO anon;
GRANT ALL ON public.promotions TO authenticated;
GRANT ALL ON public.promotions TO service_role;
