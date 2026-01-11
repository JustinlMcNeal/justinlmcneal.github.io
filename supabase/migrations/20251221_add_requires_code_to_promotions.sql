-- Add requires_code field to promotions table
-- This distinguishes between auto-apply promotions and coupon codes
ALTER TABLE public.promotions 
ADD COLUMN requires_code BOOLEAN DEFAULT false;

-- Add comment for clarity
COMMENT ON COLUMN public.promotions.requires_code IS 
'If true, promotion only applies when customer enters the code at checkout. If false, promotion applies automatically.';

-- Create index for filtering
CREATE INDEX IF NOT EXISTS idx_promotions_requires_code ON public.promotions(requires_code);
