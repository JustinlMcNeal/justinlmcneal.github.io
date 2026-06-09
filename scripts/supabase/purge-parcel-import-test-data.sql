-- Purge parcel import rows created by regression tests / fixtures.
-- Targets: fixture parcel 227461, sample_baestao files, SQL validation fixtures.
-- Run: npx supabase db query --linked -f scripts/supabase/purge-parcel-import-test-data.sql
--
-- Child tables cascade from parcel_imports. Linked expenses are deleted only when
-- exclusively tied to a purged import (no other parcel_imports reference them).

BEGIN;

CREATE TEMP TABLE _parcel_import_purge_targets ON COMMIT DROP AS
SELECT id, parcel_id, source_file_name, status, expense_id
FROM public.parcel_imports
WHERE parcel_id = '227461'
   OR parcel_id IN ('phase8-val-approved', 'phase8-val-ready')
   OR source_file_name ILIKE '%sample_baestao%'
   OR source_file_name ILIKE 'baestao_parcel_0142%';

SELECT 'targets' AS step, count(*)::int AS import_count
FROM _parcel_import_purge_targets;

SELECT status, count(*)::int AS n
FROM _parcel_import_purge_targets
GROUP BY status
ORDER BY status;

CREATE TEMP TABLE _parcel_import_purge_expenses ON COMMIT DROP AS
SELECT DISTINCT t.expense_id
FROM _parcel_import_purge_targets t
WHERE t.expense_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.parcel_imports p
    WHERE p.expense_id = t.expense_id
      AND p.id NOT IN (SELECT id FROM _parcel_import_purge_targets)
  );

SELECT 'orphan_expenses' AS step, count(*)::int AS expense_count
FROM _parcel_import_purge_expenses;

DELETE FROM public.parcel_imports
WHERE id IN (SELECT id FROM _parcel_import_purge_targets);

DELETE FROM public.expenses
WHERE id IN (SELECT expense_id FROM _parcel_import_purge_expenses);

SELECT 'remaining_imports' AS step, count(*)::int AS import_count
FROM public.parcel_imports;

COMMIT;

SELECT 'purge complete' AS result;
