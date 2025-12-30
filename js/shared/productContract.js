export const PRODUCT_SELECT = `
  id,
  code,
  slug,
  name,
  category_id,
  price,
  weight_g,
  shipping_status,
  catalog_image_url,
  catalog_hover_url,
  primary_image_url,
  is_active,
  created_at,
  updated_at
`.replace(/\s+/g, " ").trim();
