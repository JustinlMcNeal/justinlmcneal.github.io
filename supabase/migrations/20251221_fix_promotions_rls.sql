-- Fix RLS for promotions table
-- Drop existing policies if they exist
DROP POLICY IF EXISTS "public_can_read_active_promotions" ON public.promotions;
DROP POLICY IF EXISTS "admin_can_manage_promotions" ON public.promotions;

-- Policy 1: Anyone can read active public promotions
CREATE POLICY "public_read_active_promotions"
  ON public.promotions
  FOR SELECT
  TO public
  USING (is_public = true AND is_active = true);

-- Policy 2: Service role (backend/admin) can do everything
CREATE POLICY "service_role_manage_promotions"
  ON public.promotions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Policy 3: Authenticated users (admin via JWT) can manage
CREATE POLICY "authenticated_manage_own_promotions"
  ON public.promotions
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Grant full permissions to authenticated users and service_role
GRANT ALL ON public.promotions TO authenticated;
GRANT ALL ON public.promotions TO service_role;
GRANT SELECT ON public.promotions TO anon;
