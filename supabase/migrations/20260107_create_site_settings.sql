-- Create site_settings table for announcement bar and other global settings
CREATE TABLE IF NOT EXISTS public.site_settings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  
  -- Setting key (unique identifier)
  key TEXT NOT NULL UNIQUE,
  
  -- Setting value (JSON for flexibility)
  value JSONB NOT NULL DEFAULT '{}',
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_site_settings_key ON public.site_settings(key);

-- Enable RLS
ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;

-- Public read policy (anyone can read settings)
CREATE POLICY "Anyone can read site settings"
  ON public.site_settings
  FOR SELECT
  USING (true);

-- Admin write policy (authenticated users can update)
CREATE POLICY "Authenticated users can update site settings"
  ON public.site_settings
  FOR ALL
  USING (auth.role() = 'authenticated');

-- Insert default announcement bar setting
INSERT INTO public.site_settings (key, value) VALUES (
  'announcement_bar',
  '{
    "enabled": false,
    "text": "FREE SHIPPING on orders over $50!",
    "link": "",
    "bg_color": "#000000",
    "text_color": "#ffffff",
    "show_close": true
  }'::jsonb
) ON CONFLICT (key) DO NOTHING;

-- Insert default free shipping threshold setting
INSERT INTO public.site_settings (key, value) VALUES (
  'free_shipping',
  '{
    "enabled": true,
    "threshold": 50.00,
    "message_under": "Spend ${remaining} more for FREE shipping!",
    "message_reached": "🎉 You qualify for FREE shipping!"
  }'::jsonb
) ON CONFLICT (key) DO NOTHING;
