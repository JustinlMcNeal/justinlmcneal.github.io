-- Migration: Create RPC for batch-updating line item product_id + metadata.
-- Uses SECURITY DEFINER to bypass RLS on line_items_raw.
-- Called by the eBay re-match button (and future Amazon re-match).

CREATE OR REPLACE FUNCTION public.rpc_batch_update_line_item_products(
  p_updates jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int := 0;
BEGIN
  -- p_updates is a JSON array of objects:
  --   [{ "line_item_id": "<uuid>", "product_id": "KK-0002",
  --      "product_name": "Mini Tote - Heart Embossed",
  --      "item_weight_g": 150 }]

  UPDATE line_items_raw li
  SET
    product_id   = u.new_product_id,
    product_name = COALESCE(u.new_product_name, li.product_name),
    item_weight_g = COALESCE(u.new_weight_g, li.item_weight_g),
    updated_at   = now()
  FROM (
    SELECT
      (elem->>'line_item_id')::uuid  AS lid,
      elem->>'product_id'            AS new_product_id,
      NULLIF(elem->>'product_name', '') AS new_product_name,
      (elem->>'item_weight_g')::int  AS new_weight_g
    FROM jsonb_array_elements(p_updates) AS elem
  ) u
  WHERE li.id = u.lid;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('updated_count', v_count);
END;
$$;
