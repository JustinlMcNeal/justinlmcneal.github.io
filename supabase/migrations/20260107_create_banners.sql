-- Create banners table
CREATE TABLE IF NOT EXISTS public.banners (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now(),
  
  -- Visuals
  title TEXT NOT NULL,
  subtitle TEXT,
  image_url TEXT NOT NULL,
  
  -- Action
  link_url TEXT, -- Can be absolute, relative, or special schema like promo:CODE
  btn_text TEXT DEFAULT 'Shop Now',
  label TEXT DEFAULT 'Featured', -- The pill tag (e.g. "New Drop")
  
  -- Control
  active BOOLEAN DEFAULT false,
  sort_order INTEGER DEFAULT 0
);

-- RLS Policies
ALTER TABLE public.banners ENABLE ROW LEVEL SECURITY;

-- Everyone can read active banners
CREATE POLICY "Public can view active banners" 
ON public.banners FOR SELECT 
USING (active = true);

-- Admins can do everything (Assuming authenticated role for now, or specific admin role logic later)
-- For now we'll allow authenticated users to manage them, similar to other tables in this dev setup
CREATE POLICY "Authenticated users can manage banners" 
ON public.banners FOR ALL 
TO authenticated 
USING (true) 
WITH CHECK (true);

-- Storage bucket for banners
insert into storage.buckets (id, name, public) 
values ('banners', 'banners', true)
on conflict (id) do nothing;

create policy "Banner images are publicly accessible"
on storage.objects for select
using ( bucket_id = 'banners' );

create policy "Authenticated users can upload banner images"
on storage.objects for insert
with check ( bucket_id = 'banners' AND auth.role() = 'authenticated' );

create policy "Authenticated users can update banner images"
on storage.objects for update
with check ( bucket_id = 'banners' AND auth.role() = 'authenticated' );

create policy "Authenticated users can delete banner images"
on storage.objects for delete
using ( bucket_id = 'banners' AND auth.role() = 'authenticated' );
