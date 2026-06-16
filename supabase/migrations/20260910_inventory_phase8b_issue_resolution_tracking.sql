-- Phase 8B — inventory issue workflow state (snooze / reviewed / resolved).
-- Detected issues remain in v_inventory_issues; this table layers admin workflow only.

CREATE TABLE IF NOT EXISTS public.inventory_issue_states (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_key       text NOT NULL UNIQUE,
  issue_type      text NOT NULL,
  source          text,
  reference_type  text,
  reference_id    text,
  variant_id      uuid REFERENCES public.product_variants(id) ON DELETE SET NULL,
  product_id      uuid REFERENCES public.products(id) ON DELETE SET NULL,
  status          text NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open', 'reviewed', 'snoozed', 'resolved', 'ignored')),
  snoozed_until   timestamptz,
  resolution_note text,
  assigned_to     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.inventory_issue_states IS
  'Admin workflow state for inventory issues (Phase 8B). Does not mutate stock or reservations.';

CREATE INDEX IF NOT EXISTS idx_inventory_issue_states_issue_key
  ON public.inventory_issue_states (issue_key);

CREATE INDEX IF NOT EXISTS idx_inventory_issue_states_issue_type
  ON public.inventory_issue_states (issue_type);

CREATE INDEX IF NOT EXISTS idx_inventory_issue_states_status
  ON public.inventory_issue_states (status);

CREATE INDEX IF NOT EXISTS idx_inventory_issue_states_snoozed_until
  ON public.inventory_issue_states (snoozed_until)
  WHERE snoozed_until IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_issue_states_variant_id
  ON public.inventory_issue_states (variant_id)
  WHERE variant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_issue_states_product_id
  ON public.inventory_issue_states (product_id)
  WHERE product_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'inventory_issue_states_set_updated_at'
  ) THEN
    CREATE TRIGGER inventory_issue_states_set_updated_at
      BEFORE UPDATE ON public.inventory_issue_states
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

ALTER TABLE public.inventory_issue_states ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inventory_issue_states_service_role_all ON public.inventory_issue_states;
CREATE POLICY inventory_issue_states_service_role_all
  ON public.inventory_issue_states FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS inventory_issue_states_authenticated_select ON public.inventory_issue_states;
CREATE POLICY inventory_issue_states_authenticated_select
  ON public.inventory_issue_states FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS inventory_issue_states_authenticated_insert ON public.inventory_issue_states;
CREATE POLICY inventory_issue_states_authenticated_insert
  ON public.inventory_issue_states FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS inventory_issue_states_authenticated_update ON public.inventory_issue_states;
CREATE POLICY inventory_issue_states_authenticated_update
  ON public.inventory_issue_states FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);

GRANT ALL ON public.inventory_issue_states TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.inventory_issue_states TO authenticated;

-- Join detected issue groups with group-level workflow state.
CREATE OR REPLACE VIEW public.v_inventory_issues_with_state AS
SELECT
  i.issue_id,
  i.issue_type,
  i.issue_label,
  i.severity,
  i.description,
  i.affected_count,
  i.source,
  i.reference,
  i.updated_at,
  COALESCE(s.status, 'open'::text) AS workflow_status,
  s.snoozed_until,
  s.resolution_note,
  s.id AS issue_state_id,
  s.updated_at AS state_updated_at,
  (
    COALESCE(s.status, 'open') NOT IN ('resolved', 'ignored')
    AND NOT (
      COALESCE(s.status, 'open') = 'snoozed'
      AND s.snoozed_until IS NOT NULL
      AND s.snoozed_until > now()
    )
  ) AS is_active_workflow,
  (
    COALESCE(s.status, 'open') = 'snoozed'
    AND s.snoozed_until IS NOT NULL
    AND s.snoozed_until > now()
  ) AS is_snoozed_active
FROM public.v_inventory_issues i
LEFT JOIN public.inventory_issue_states s
  ON s.issue_key = ('group:' || i.issue_type);

COMMENT ON VIEW public.v_inventory_issues_with_state IS
  'Detected inventory issue groups joined with admin workflow state (Phase 8B).';

GRANT SELECT ON public.v_inventory_issues_with_state TO authenticated;
GRANT SELECT ON public.v_inventory_issues_with_state TO service_role;
