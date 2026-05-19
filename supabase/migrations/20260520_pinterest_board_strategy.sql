-- Pinterest board strategy fields (search-intent routing)

ALTER TABLE pinterest_boards
  ADD COLUMN IF NOT EXISTS intent_key TEXT DEFAULT 'product-category',
  ADD COLUMN IF NOT EXISTS content_types TEXT[] DEFAULT ARRAY['product']::TEXT[],
  ADD COLUMN IF NOT EXISTS mapped_category_ids UUID[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS strategy_notes TEXT,
  ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;

ALTER TABLE pinterest_boards
  DROP CONSTRAINT IF EXISTS pinterest_boards_intent_key_check;

ALTER TABLE pinterest_boards
  ADD CONSTRAINT pinterest_boards_intent_key_check
  CHECK (intent_key IS NULL OR intent_key IN (
    'everyday-style',
    'gifting',
    'going-out',
    'cute-accessories',
    'seasonal',
    'customer-favorites',
    'best-sellers',
    'outfit-ideas',
    'product-category',
    'other'
  ));

CREATE INDEX IF NOT EXISTS idx_pinterest_boards_intent ON pinterest_boards(intent_key);
CREATE INDEX IF NOT EXISTS idx_pinterest_boards_active ON pinterest_boards(is_active);

COMMENT ON COLUMN pinterest_boards.intent_key IS 'Search-intent bucket for Pinterest routing';
COMMENT ON COLUMN pinterest_boards.content_types IS 'Image Pool content types eligible for this board';
COMMENT ON COLUMN pinterest_boards.mapped_category_ids IS 'Product category UUIDs routed to this board';
