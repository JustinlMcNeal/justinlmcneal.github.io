-- Add color column to look items
ALTER TABLE public.shop_look_items 
ADD COLUMN IF NOT EXISTS dot_color TEXT DEFAULT 'white';
