-- ─────────────────────────────────────────────────────────────────────────────
-- Dedup auto-imported expenses
--
-- Root cause: findExistingAmazonExpenses / findExistingEbayExpenses were
-- searching the `description` column for ref IDs, but refs are stored in
-- `notes` (e.g. "Ref: amz_sub_2026-02-16"). Every re-import created fresh
-- rows because the check always came back empty.
--
-- This migration deletes all duplicate auto-imported rows, keeping only the
-- earliest inserted row (MIN id) for each unique ref value in `notes`.
-- ─────────────────────────────────────────────────────────────────────────────

-- Step 1: Delete duplicate Amazon & eBay auto-imported expenses.
-- Two rows are duplicates when they share the same `notes` text AND the same
-- `amount_cents` (guards against accidentally deleting unrelated rows that
-- happen to have similar notes).
DELETE FROM expenses
WHERE id IN (
  SELECT e.id
  FROM expenses e
  INNER JOIN (
    -- Find duplicate groups: same notes + amount, keep the MIN (earliest) id
    SELECT notes, amount_cents, MIN(id) AS keep_id
    FROM expenses
    WHERE (
      notes ILIKE '%Ref: amz_%'
      OR notes ILIKE '%Ref: ebay_%'
    )
    GROUP BY notes, amount_cents
    HAVING COUNT(*) > 1
  ) AS dupes
    ON e.notes = dupes.notes
   AND e.amount_cents = dupes.amount_cents
   AND e.id <> dupes.keep_id  -- delete all except the one we're keeping
  WHERE (
    e.notes ILIKE '%Ref: amz_%'
    OR e.notes ILIKE '%Ref: ebay_%'
  )
);
