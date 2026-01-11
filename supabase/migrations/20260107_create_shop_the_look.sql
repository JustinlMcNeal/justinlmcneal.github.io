-- Create looks table
CREATE TABLE IF NOT EXISTS public.shop_looks (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at TIMESTAMPTZ DEFAULT now(),
    title TEXT,
    description TEXT,
    image_url TEXT, -- Changed to nullable for easier drafts
    is_active BOOLEAN DEFAULT false,
    sort_order INTEGER DEFAULT 0
);

-- Create items/hotspots table
-- Links a specific point (x,y) on a Look to a Product
CREATE TABLE IF NOT EXISTS public.shop_look_items (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    look_id UUID REFERENCES public.shop_looks(id) ON DELETE CASCADE,
    product_id UUID REFERENCES public.products(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now(),
    x_position DECIMAL NOT NULL, -- Percentage (0-100) from left
    y_position DECIMAL NOT NULL, -- Percentage (0-100) from top
    sort_order INTEGER DEFAULT 0
);

-- RLS Policies
ALTER TABLE public.shop_looks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_look_items ENABLE ROW LEVEL SECURITY;

-- Public read access
CREATE POLICY "Public looks are viewable by everyone" ON public.shop_looks
    FOR SELECT USING (true);

CREATE POLICY "Public look items are viewable by everyone" ON public.shop_look_items
    FOR SELECT USING (true);

-- Admin write access (assuming authenticated admins)
CREATE POLICY "Admins can manage looks" ON public.shop_looks
    FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Admins can manage look items" ON public.shop_look_items
    FOR ALL USING (auth.role() = 'authenticated');
