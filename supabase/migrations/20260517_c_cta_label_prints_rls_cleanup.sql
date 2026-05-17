-- ================================================================
-- CTA Label Prints: RLS cleanup after Phase 2D migration
-- Phase 2D moves all inserts into cta_label_prints to the
-- track-cta-label-print Edge Function (service role).
-- The authenticated INSERT policy created in Phase 2C is now dead
-- code — no browser JS inserts directly anymore.
--
-- Run this in the Supabase SQL editor or via db push:
--   DROP the authenticated INSERT policy (no browser should INSERT directly)
--   ADD an authenticated SELECT policy (future admin analytics UI)
-- ================================================================

-- Drop the Phase 2C browser-insert policy (no longer used)
DROP POLICY IF EXISTS "cta_label_prints_authenticated_insert"
  ON cta_label_prints;

-- Add authenticated SELECT for future admin analytics / reporting
CREATE POLICY "cta_label_prints_authenticated_select"
  ON cta_label_prints
  FOR SELECT
  TO authenticated
  USING (true);

-- service_role ALL policy from Phase 2C remains unchanged.
