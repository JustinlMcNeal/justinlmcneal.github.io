-- Create product_review_stats summary table for cached star ratings
-- This replaces on-the-fly computation for catalog/product pages

-- ── Table ──
CREATE TABLE IF NOT EXISTS product_review_stats (
  product_id TEXT PRIMARY KEY,
  avg_rating NUMERIC(2,1) NOT NULL DEFAULT 0,
  review_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── RLS: anon can read, service_role can write ──
ALTER TABLE product_review_stats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_read_review_stats" ON product_review_stats;
CREATE POLICY "anon_read_review_stats" ON product_review_stats
  FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "service_role_all_review_stats" ON product_review_stats;
CREATE POLICY "service_role_all_review_stats" ON product_review_stats
  FOR ALL TO service_role USING (true);

DROP POLICY IF EXISTS "authenticated_read_review_stats" ON product_review_stats;
CREATE POLICY "authenticated_read_review_stats" ON product_review_stats
  FOR SELECT TO authenticated USING (true);

-- ── Function to refresh stats for a single product ──
CREATE OR REPLACE FUNCTION refresh_product_review_stats()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  target_pid TEXT;
BEGIN
  -- Determine which product_id to refresh
  IF TG_OP = 'DELETE' THEN
    target_pid := OLD.product_id;
  ELSE
    target_pid := NEW.product_id;
  END IF;

  -- Also refresh OLD product_id on UPDATE if it changed
  IF TG_OP = 'UPDATE' AND OLD.product_id IS DISTINCT FROM NEW.product_id THEN
    -- Refresh the old product
    INSERT INTO product_review_stats (product_id, avg_rating, review_count, updated_at)
    SELECT
      OLD.product_id,
      COALESCE(ROUND(AVG(rating)::numeric, 1), 0),
      COUNT(*),
      now()
    FROM reviews
    WHERE product_id = OLD.product_id AND status = 'approved'
    ON CONFLICT (product_id) DO UPDATE SET
      avg_rating = EXCLUDED.avg_rating,
      review_count = EXCLUDED.review_count,
      updated_at = now();

    -- Clean up if no reviews left
    DELETE FROM product_review_stats
    WHERE product_id = OLD.product_id AND review_count = 0;
  END IF;

  -- Refresh the target product
  IF target_pid IS NOT NULL THEN
    INSERT INTO product_review_stats (product_id, avg_rating, review_count, updated_at)
    SELECT
      target_pid,
      COALESCE(ROUND(AVG(rating)::numeric, 1), 0),
      COUNT(*),
      now()
    FROM reviews
    WHERE product_id = target_pid AND status = 'approved'
    ON CONFLICT (product_id) DO UPDATE SET
      avg_rating = EXCLUDED.avg_rating,
      review_count = EXCLUDED.review_count,
      updated_at = now();

    -- Clean up if no reviews left
    DELETE FROM product_review_stats
    WHERE product_id = target_pid AND review_count = 0;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ── Trigger on reviews table ──
DROP TRIGGER IF EXISTS trg_refresh_review_stats ON reviews;
CREATE TRIGGER trg_refresh_review_stats
  AFTER INSERT OR UPDATE OR DELETE ON reviews
  FOR EACH ROW
  EXECUTE FUNCTION refresh_product_review_stats();

-- ── Seed initial data from existing reviews ──
INSERT INTO product_review_stats (product_id, avg_rating, review_count, updated_at)
SELECT
  product_id,
  ROUND(AVG(rating)::numeric, 1),
  COUNT(*),
  now()
FROM reviews
WHERE product_id IS NOT NULL AND status = 'approved'
GROUP BY product_id
ON CONFLICT (product_id) DO UPDATE SET
  avg_rating = EXCLUDED.avg_rating,
  review_count = EXCLUDED.review_count,
  updated_at = now();
