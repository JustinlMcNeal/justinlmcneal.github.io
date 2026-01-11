-- DROP existing tables (ORDER MATTERS due to foreign keys)
DROP TABLE IF EXISTS public.shop_look_items;
DROP TABLE IF EXISTS public.shop_looks;

-- Create looks table
CREATE TABLE public.shop_looks (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at TIMESTAMPTZ DEFAULT now(),
    title TEXT,
    description TEXT,
    image_url TEXT, -- Nullable for draft state
    is_active BOOLEAN DEFAULT false,
    sort_order INTEGER DEFAULT 0
);

-- Create items/hotspots table
CREATE TABLE public.shop_look_items (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    look_id UUID REFERENCES public.shop_looks(id) ON DELETE CASCADE,
    product_id UUID REFERENCES public.products(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now(),
    x_position DECIMAL NOT NULL,
    y_position DECIMAL NOT NULL,
    dot_color TEXT DEFAULT 'white', -- Added dot_color
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
