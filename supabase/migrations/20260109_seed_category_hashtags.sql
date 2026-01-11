-- ============================================
-- Category-specific hashtags for social media
-- Run this after the main migration
-- ============================================

-- First, let's insert hashtags for common apparel categories
-- These will be matched by category name (case-insensitive)

-- Headwear / Hats
INSERT INTO social_category_hashtags (category_name, hashtags) VALUES
  ('headwear', ARRAY['#karrykraze', '#hats', '#caps', '#headwear', '#snapback', '#beanie', '#fashion', '#streetwear', '#accessories', '#hatcollection', '#hatlife']),
  ('hats', ARRAY['#karrykraze', '#hats', '#caps', '#headwear', '#snapback', '#beanie', '#fashion', '#streetwear', '#accessories', '#hatcollection', '#hatlife'])
ON CONFLICT DO NOTHING;

-- Bags
INSERT INTO social_category_hashtags (category_name, hashtags) VALUES
  ('bags', ARRAY['#karrykraze', '#bags', '#handbags', '#totebag', '#crossbody', '#backpack', '#accessories', '#fashion', '#bagoftheday', '#pursesofinstagram', '#styleinspo']),
  ('purses', ARRAY['#karrykraze', '#purse', '#handbags', '#clutch', '#accessories', '#fashion', '#pursesofinstagram', '#bagaddict', '#designerbags'])
ON CONFLICT DO NOTHING;

-- Apparel / Clothing
INSERT INTO social_category_hashtags (category_name, hashtags) VALUES
  ('apparel', ARRAY['#karrykraze', '#fashion', '#ootd', '#style', '#clothing', '#streetwear', '#outfitoftheday', '#fashionista', '#instafashion', '#styleinspo']),
  ('clothing', ARRAY['#karrykraze', '#fashion', '#ootd', '#style', '#clothing', '#streetwear', '#outfitoftheday', '#fashionista', '#instafashion', '#styleinspo']),
  ('shirts', ARRAY['#karrykraze', '#shirts', '#tshirt', '#graphictee', '#fashion', '#ootd', '#streetwear', '#casualstyle', '#mensfashion', '#womensfashion']),
  ('tops', ARRAY['#karrykraze', '#tops', '#fashion', '#ootd', '#style', '#casualwear', '#streetstyle', '#instafashion'])
ON CONFLICT DO NOTHING;

-- Accessories
INSERT INTO social_category_hashtags (category_name, hashtags) VALUES
  ('accessories', ARRAY['#karrykraze', '#accessories', '#fashion', '#style', '#jewelry', '#sunglasses', '#watches', '#fashionaccessories', '#styleinspo', '#trendy']),
  ('jewelry', ARRAY['#karrykraze', '#jewelry', '#accessories', '#necklace', '#bracelet', '#earrings', '#fashionjewelry', '#jewelryaddict', '#instajewelry'])
ON CONFLICT DO NOTHING;

-- Footwear
INSERT INTO social_category_hashtags (category_name, hashtags) VALUES
  ('footwear', ARRAY['#karrykraze', '#shoes', '#footwear', '#sneakers', '#kicks', '#shoegame', '#sneakerhead', '#fashion', '#streetwear', '#shoesoftheday']),
  ('shoes', ARRAY['#karrykraze', '#shoes', '#footwear', '#sneakers', '#kicks', '#shoegame', '#sneakerhead', '#fashion', '#streetwear', '#shoesoftheday'])
ON CONFLICT DO NOTHING;

-- Seasonal
INSERT INTO social_category_hashtags (category_name, hashtags) VALUES
  ('winter', ARRAY['#karrykraze', '#winterfashion', '#coldweather', '#cozy', '#winterstyle', '#layering', '#fashion', '#warmandstylish']),
  ('summer', ARRAY['#karrykraze', '#summerfashion', '#summervibes', '#beachstyle', '#sunnyday', '#vacationmode', '#fashion', '#summerstyle'])
ON CONFLICT DO NOTHING;
