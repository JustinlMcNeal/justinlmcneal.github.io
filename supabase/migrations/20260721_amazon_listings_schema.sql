-- ================================================================
-- KK Amazon Listings — Phase 2C Supabase Schema
-- Source: docs/pages/admin/amazon/ux/012_official_sp_api_research.md (§13)
--
-- Creates Amazon seller account, listing, mapping, draft, sync, issue,
-- push queue, and product type cache tables.
-- Does NOT wire SP-API edge functions or frontend live reads.
-- ================================================================

-- ── updated_at helper (idempotent) ─────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ════════════════════════════════════════════════════════════════
-- 1. amazon_seller_accounts
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.amazon_seller_accounts (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id               text        NOT NULL UNIQUE,
  account_label           text,
  region                  text        NOT NULL DEFAULT 'na'
                          CHECK (region IN ('na', 'eu', 'fe')),
  marketplace_ids         text[]      NOT NULL DEFAULT '{}',
  is_active               boolean     NOT NULL DEFAULT true,
  authorized_at           timestamptz,
  last_token_refresh_at   timestamptz,
  token_status            text        NOT NULL DEFAULT 'not_connected'
                          CHECK (token_status IN (
                            'not_connected', 'active', 'revoked', 'expired', 'error'
                          )),
  scopes_roles_snapshot   jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.amazon_seller_accounts IS
  'Authorized Amazon seller accounts for SP-API sync. Non-secret metadata only; tokens live in amazon_auth_tokens.';

CREATE INDEX IF NOT EXISTS idx_amazon_seller_accounts_region
  ON public.amazon_seller_accounts (region);
CREATE INDEX IF NOT EXISTS idx_amazon_seller_accounts_is_active
  ON public.amazon_seller_accounts (is_active);
CREATE INDEX IF NOT EXISTS idx_amazon_seller_accounts_token_status
  ON public.amazon_seller_accounts (token_status);

-- ════════════════════════════════════════════════════════════════
-- 2. amazon_auth_tokens (server-side only — strict RLS)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.amazon_auth_tokens (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_account_id           uuid        NOT NULL
                              REFERENCES public.amazon_seller_accounts(id) ON DELETE CASCADE,
  lwa_refresh_token_encrypted text,
  vault_secret_name           text,
  token_status                text        NOT NULL DEFAULT 'active'
                              CHECK (token_status IN ('active', 'revoked', 'expired', 'error')),
  last_refresh_at             timestamptz,
  last_error                  text,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT amazon_auth_tokens_one_active_per_account
    UNIQUE (seller_account_id)
);

COMMENT ON TABLE public.amazon_auth_tokens IS
  'Server-side LWA refresh token storage. Never expose to browser clients. Prefer vault_secret_name when Supabase Vault is available.';

CREATE INDEX IF NOT EXISTS idx_amazon_auth_tokens_seller_account
  ON public.amazon_auth_tokens (seller_account_id);
CREATE INDEX IF NOT EXISTS idx_amazon_auth_tokens_status
  ON public.amazon_auth_tokens (token_status);

-- ════════════════════════════════════════════════════════════════
-- 3. amazon_marketplaces
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.amazon_marketplaces (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  marketplace_id  text        NOT NULL UNIQUE,
  country_code    text        NOT NULL,
  name            text        NOT NULL,
  domain          text,
  region          text        NOT NULL DEFAULT 'na'
                  CHECK (region IN ('na', 'eu', 'fe')),
  is_enabled      boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.amazon_marketplaces IS
  'Supported Amazon marketplaces referenced by listings, drafts, and sync runs.';

CREATE INDEX IF NOT EXISTS idx_amazon_marketplaces_region
  ON public.amazon_marketplaces (region);
CREATE INDEX IF NOT EXISTS idx_amazon_marketplaces_is_enabled
  ON public.amazon_marketplaces (is_enabled);

INSERT INTO public.amazon_marketplaces (
  marketplace_id, country_code, name, domain, region, is_enabled
) VALUES (
  'ATVPDKIKX0DER', 'US', 'Amazon.com', 'amazon.com', 'na', true
)
ON CONFLICT (marketplace_id) DO NOTHING;

-- ════════════════════════════════════════════════════════════════
-- 4. amazon_listings
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.amazon_listings (
  id                          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_account_id           uuid          NOT NULL
                              REFERENCES public.amazon_seller_accounts(id) ON DELETE CASCADE,
  seller_id                   text          NOT NULL,
  marketplace_id              text          NOT NULL
                              REFERENCES public.amazon_marketplaces(marketplace_id),
  asin                        text,
  seller_sku                  text          NOT NULL,
  fn_sku                      text,
  amazon_title                text,
  product_type                text,
  condition_type              text,
  listing_status              text          NOT NULL DEFAULT 'unknown'
                              CHECK (listing_status IN (
                                'active', 'inactive', 'out_of_stock', 'low_stock',
                                'draft', 'issue', 'suppressed', 'unknown'
                              )),
  listing_status_buyable      boolean       NOT NULL DEFAULT false,
  listing_status_discoverable boolean       NOT NULL DEFAULT false,
  price                       numeric(12,2),
  currency                    text          DEFAULT 'USD',
  fulfillment_channel         text,
  fbm_quantity                integer,
  fba_fulfillable_quantity    integer,
  fba_reserved_quantity       integer,
  fba_inbound_quantity        integer,
  quantity_last_source        text
                              CHECK (quantity_last_source IS NULL OR quantity_last_source IN (
                                'listings', 'fba_inventory', 'manual', 'unknown'
                              )),
  quantity_synced_at          timestamptz,
  price_synced_at             timestamptz,
  last_synced_at              timestamptz,
  relationships               jsonb         NOT NULL DEFAULT '{}'::jsonb,
  enforcements                jsonb         NOT NULL DEFAULT '{}'::jsonb,
  raw_listing                 jsonb         NOT NULL DEFAULT '{}'::jsonb,
  created_at                  timestamptz   NOT NULL DEFAULT now(),
  updated_at                  timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT amazon_listings_account_marketplace_sku_unique
    UNIQUE (seller_account_id, marketplace_id, seller_sku)
);

COMMENT ON TABLE public.amazon_listings IS
  'Seller Amazon listing/offer rows imported via SP-API Listings Items search/get. Upsert key: seller_account + marketplace + seller_sku.';

CREATE INDEX IF NOT EXISTS idx_amazon_listings_seller_account
  ON public.amazon_listings (seller_account_id);
CREATE INDEX IF NOT EXISTS idx_amazon_listings_marketplace
  ON public.amazon_listings (marketplace_id);
CREATE INDEX IF NOT EXISTS idx_amazon_listings_seller_sku
  ON public.amazon_listings (seller_sku);
CREATE INDEX IF NOT EXISTS idx_amazon_listings_asin
  ON public.amazon_listings (asin);
CREATE INDEX IF NOT EXISTS idx_amazon_listings_status
  ON public.amazon_listings (listing_status);
CREATE INDEX IF NOT EXISTS idx_amazon_listings_last_synced
  ON public.amazon_listings (last_synced_at DESC);
CREATE INDEX IF NOT EXISTS idx_amazon_listings_buyable
  ON public.amazon_listings (listing_status_buyable);
CREATE INDEX IF NOT EXISTS idx_amazon_listings_discoverable
  ON public.amazon_listings (listing_status_discoverable);

-- ════════════════════════════════════════════════════════════════
-- 5. amazon_listing_mappings
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.amazon_listing_mappings (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  amazon_listing_id   uuid        NOT NULL
                      REFERENCES public.amazon_listings(id) ON DELETE CASCADE,
  kk_product_id       uuid        REFERENCES public.products(id) ON DELETE SET NULL,
  kk_sku              text,
  mapping_status      text        NOT NULL DEFAULT 'needs_review'
                      CHECK (mapping_status IN (
                        'mapped', 'suggested', 'ignored', 'legacy', 'needs_review'
                      )),
  mapping_confidence  text
                      CHECK (mapping_confidence IS NULL OR mapping_confidence IN (
                        'high', 'medium', 'low', 'manual', 'unknown'
                      )),
  mapped_by           uuid,
  mapped_at           timestamptz,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.amazon_listing_mappings IS
  'Join between Amazon listings and KK products. One active mapped row per listing enforced by partial unique index.';

CREATE INDEX IF NOT EXISTS idx_amazon_listing_mappings_listing
  ON public.amazon_listing_mappings (amazon_listing_id);
CREATE INDEX IF NOT EXISTS idx_amazon_listing_mappings_product
  ON public.amazon_listing_mappings (kk_product_id);
CREATE INDEX IF NOT EXISTS idx_amazon_listing_mappings_kk_sku
  ON public.amazon_listing_mappings (kk_sku);
CREATE INDEX IF NOT EXISTS idx_amazon_listing_mappings_status
  ON public.amazon_listing_mappings (mapping_status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_amazon_listing_mappings_one_mapped
  ON public.amazon_listing_mappings (amazon_listing_id)
  WHERE mapping_status = 'mapped';

-- ════════════════════════════════════════════════════════════════
-- 6. amazon_listing_drafts
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.amazon_listing_drafts (
  id                          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_account_id           uuid          REFERENCES public.amazon_seller_accounts(id) ON DELETE CASCADE,
  seller_id                   text,
  kk_product_id               uuid          REFERENCES public.products(id) ON DELETE SET NULL,
  kk_sku                      text,
  marketplace_id              text          REFERENCES public.amazon_marketplaces(marketplace_id),
  asin                        text,
  matched_asin                text,
  seller_sku                  text,
  product_type                text,
  requirements                text
                              CHECK (requirements IS NULL OR requirements IN (
                                'LISTING', 'LISTING_PRODUCT_ONLY', 'LISTING_OFFER_ONLY'
                              )),
  requirements_enforced       text,
  product_type_version        text,
  parentage_level             text
                              CHECK (parentage_level IS NULL OR parentage_level IN (
                                'CHILD', 'PARENT', 'NONE'
                              )),
  push_workflow               text
                              CHECK (push_workflow IS NULL OR push_workflow IN (
                                'new_catalog', 'offer_on_asin', 'create_local_draft_only'
                              )),
  draft_status                text          NOT NULL DEFAULT 'draft'
                              CHECK (draft_status IN (
                                'draft', 'needs_attributes', 'ready_to_submit',
                                'submitted', 'rejected', 'published', 'archived'
                              )),
  draft_payload               jsonb         NOT NULL DEFAULT '{}'::jsonb,
  catalog_snapshot            jsonb         NOT NULL DEFAULT '{}'::jsonb,
  validation_errors           jsonb         NOT NULL DEFAULT '[]'::jsonb,
  submission_id               text,
  submission_status           text
                              CHECK (submission_status IS NULL OR submission_status IN (
                                'ACCEPTED', 'INVALID', 'VALID', 'processing', 'failed'
                              )),
  last_validation_result      jsonb         NOT NULL DEFAULT '{}'::jsonb,
  last_submission_response    jsonb         NOT NULL DEFAULT '{}'::jsonb,
  published_amazon_listing_id uuid          REFERENCES public.amazon_listings(id) ON DELETE SET NULL,
  last_previewed_at           timestamptz,
  submitted_at                timestamptz,
  created_at                  timestamptz   NOT NULL DEFAULT now(),
  updated_at                  timestamptz   NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.amazon_listing_drafts IS
  'Local push-to-Amazon draft payloads and submission metadata before/after Listings Items put/patch.';

CREATE INDEX IF NOT EXISTS idx_amazon_listing_drafts_seller_account
  ON public.amazon_listing_drafts (seller_account_id);
CREATE INDEX IF NOT EXISTS idx_amazon_listing_drafts_product
  ON public.amazon_listing_drafts (kk_product_id);
CREATE INDEX IF NOT EXISTS idx_amazon_listing_drafts_kk_sku
  ON public.amazon_listing_drafts (kk_sku);
CREATE INDEX IF NOT EXISTS idx_amazon_listing_drafts_marketplace
  ON public.amazon_listing_drafts (marketplace_id);
CREATE INDEX IF NOT EXISTS idx_amazon_listing_drafts_status
  ON public.amazon_listing_drafts (draft_status);
CREATE INDEX IF NOT EXISTS idx_amazon_listing_drafts_submission_id
  ON public.amazon_listing_drafts (submission_id);

-- ════════════════════════════════════════════════════════════════
-- 7. amazon_sync_runs
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.amazon_sync_runs (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_account_id uuid        REFERENCES public.amazon_seller_accounts(id) ON DELETE CASCADE,
  sync_type         text        NOT NULL
                    CHECK (sync_type IN ('full', 'incremental', 'single_sku', 'manual')),
  marketplace_id    text        REFERENCES public.amazon_marketplaces(marketplace_id),
  status            text        NOT NULL DEFAULT 'queued'
                    CHECK (status IN (
                      'queued', 'running', 'success', 'partial_success', 'failed', 'cancelled'
                    )),
  started_at        timestamptz,
  finished_at       timestamptz,
  records_seen      integer     NOT NULL DEFAULT 0,
  records_created   integer     NOT NULL DEFAULT 0,
  records_updated   integer     NOT NULL DEFAULT 0,
  records_failed    integer     NOT NULL DEFAULT 0,
  triggered_by      uuid,
  sync_cursor       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  summary           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.amazon_sync_runs IS
  'Amazon sync job runs (searchListingsItems upsert, optional FBA enrichment). Written by edge functions.';

CREATE INDEX IF NOT EXISTS idx_amazon_sync_runs_seller_account
  ON public.amazon_sync_runs (seller_account_id);
CREATE INDEX IF NOT EXISTS idx_amazon_sync_runs_status
  ON public.amazon_sync_runs (status);
CREATE INDEX IF NOT EXISTS idx_amazon_sync_runs_sync_type
  ON public.amazon_sync_runs (sync_type);
CREATE INDEX IF NOT EXISTS idx_amazon_sync_runs_created
  ON public.amazon_sync_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_amazon_sync_runs_marketplace
  ON public.amazon_sync_runs (marketplace_id);

-- ════════════════════════════════════════════════════════════════
-- 8. amazon_sync_errors
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.amazon_sync_errors (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_run_id  uuid        REFERENCES public.amazon_sync_runs(id) ON DELETE CASCADE,
  seller_sku   text,
  asin         text,
  error_code   text,
  message      text        NOT NULL,
  raw_error    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.amazon_sync_errors IS
  'Row-level sync failures attached to amazon_sync_runs.';

CREATE INDEX IF NOT EXISTS idx_amazon_sync_errors_run
  ON public.amazon_sync_errors (sync_run_id);
CREATE INDEX IF NOT EXISTS idx_amazon_sync_errors_seller_sku
  ON public.amazon_sync_errors (seller_sku);
CREATE INDEX IF NOT EXISTS idx_amazon_sync_errors_asin
  ON public.amazon_sync_errors (asin);
CREATE INDEX IF NOT EXISTS idx_amazon_sync_errors_code
  ON public.amazon_sync_errors (error_code);
CREATE INDEX IF NOT EXISTS idx_amazon_sync_errors_created
  ON public.amazon_sync_errors (created_at DESC);

-- ════════════════════════════════════════════════════════════════
-- 9. amazon_listing_issues
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.amazon_listing_issues (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  amazon_listing_id     uuid        REFERENCES public.amazon_listings(id) ON DELETE CASCADE,
  kk_product_id         uuid        REFERENCES public.products(id) ON DELETE SET NULL,
  draft_id              uuid        REFERENCES public.amazon_listing_drafts(id) ON DELETE CASCADE,
  issue_code            text,
  issue_type            text        NOT NULL,
  severity              text        NOT NULL DEFAULT 'warning'
                        CHECK (severity IN ('info', 'warning', 'error')),
  message               text        NOT NULL,
  source                text        NOT NULL DEFAULT 'sync'
                        CHECK (source IN (
                          'sync', 'push', 'manual', 'amazon_notification', 'validation'
                        )),
  status                text        NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open', 'acknowledged', 'resolved')),
  categories            text[]      NOT NULL DEFAULT '{}',
  attribute_names       text[]      NOT NULL DEFAULT '{}',
  enforcements          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  raw_error             jsonb       NOT NULL DEFAULT '{}'::jsonb,
  source_submission_id  text,
  resolved_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.amazon_listing_issues IS
  'Listing health and workflow issues from SP-API issues dataset, push validation, or notifications.';

CREATE INDEX IF NOT EXISTS idx_amazon_listing_issues_listing
  ON public.amazon_listing_issues (amazon_listing_id);
CREATE INDEX IF NOT EXISTS idx_amazon_listing_issues_product
  ON public.amazon_listing_issues (kk_product_id);
CREATE INDEX IF NOT EXISTS idx_amazon_listing_issues_draft
  ON public.amazon_listing_issues (draft_id);
CREATE INDEX IF NOT EXISTS idx_amazon_listing_issues_type
  ON public.amazon_listing_issues (issue_type);
CREATE INDEX IF NOT EXISTS idx_amazon_listing_issues_severity
  ON public.amazon_listing_issues (severity);
CREATE INDEX IF NOT EXISTS idx_amazon_listing_issues_status
  ON public.amazon_listing_issues (status);
CREATE INDEX IF NOT EXISTS idx_amazon_listing_issues_created
  ON public.amazon_listing_issues (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_amazon_listing_issues_submission
  ON public.amazon_listing_issues (source_submission_id);

-- ════════════════════════════════════════════════════════════════
-- 10. amazon_push_queue
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.amazon_push_queue (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_account_id   uuid        REFERENCES public.amazon_seller_accounts(id) ON DELETE CASCADE,
  kk_product_id       uuid        REFERENCES public.products(id) ON DELETE SET NULL,
  draft_id            uuid        REFERENCES public.amazon_listing_drafts(id) ON DELETE SET NULL,
  marketplace_id      text        REFERENCES public.amazon_marketplaces(marketplace_id),
  action              text        NOT NULL
                      CHECK (action IN (
                        'preview', 'submit', 'create_offer', 'create_catalog',
                        'update_listing', 'feed_submit'
                      )),
  status              text        NOT NULL DEFAULT 'queued'
                      CHECK (status IN ('queued', 'running', 'success', 'failed', 'cancelled')),
  payload             jsonb       NOT NULL DEFAULT '{}'::jsonb,
  result              jsonb       NOT NULL DEFAULT '{}'::jsonb,
  attempts            integer     NOT NULL DEFAULT 0,
  last_error          text,
  submission_id       text,
  feed_id             text,
  feed_document_id    text,
  processing_status   text,
  processing_report   jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.amazon_push_queue IS
  'Optional async push/submit/feed jobs. Populated by edge functions for heavy SP-API work.';

CREATE INDEX IF NOT EXISTS idx_amazon_push_queue_seller_account
  ON public.amazon_push_queue (seller_account_id);
CREATE INDEX IF NOT EXISTS idx_amazon_push_queue_product
  ON public.amazon_push_queue (kk_product_id);
CREATE INDEX IF NOT EXISTS idx_amazon_push_queue_draft
  ON public.amazon_push_queue (draft_id);
CREATE INDEX IF NOT EXISTS idx_amazon_push_queue_marketplace
  ON public.amazon_push_queue (marketplace_id);
CREATE INDEX IF NOT EXISTS idx_amazon_push_queue_status
  ON public.amazon_push_queue (status);
CREATE INDEX IF NOT EXISTS idx_amazon_push_queue_action
  ON public.amazon_push_queue (action);
CREATE INDEX IF NOT EXISTS idx_amazon_push_queue_created
  ON public.amazon_push_queue (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_amazon_push_queue_submission
  ON public.amazon_push_queue (submission_id);
CREATE INDEX IF NOT EXISTS idx_amazon_push_queue_feed
  ON public.amazon_push_queue (feed_id);

-- ════════════════════════════════════════════════════════════════
-- 11. amazon_product_type_cache
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.amazon_product_type_cache (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  marketplace_id        text        NOT NULL
                        REFERENCES public.amazon_marketplaces(marketplace_id),
  product_type          text        NOT NULL,
  requirements          text        NOT NULL
                        CHECK (requirements IN (
                          'LISTING', 'LISTING_PRODUCT_ONLY', 'LISTING_OFFER_ONLY'
                        )),
  requirements_enforced text,
  locale                text        DEFAULT 'en_US',
  seller_account_id     uuid        REFERENCES public.amazon_seller_accounts(id) ON DELETE CASCADE,
  product_type_version  text,
  schema_url            text,
  meta_schema_url       text,
  schema_checksum       text,
  schema_snapshot       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  expires_at            timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.amazon_product_type_cache IS
  'Cached Product Type Definitions metadata and schema snapshots (PTD links expire ~7 days per Amazon docs).';

CREATE INDEX IF NOT EXISTS idx_amazon_ptd_cache_lookup
  ON public.amazon_product_type_cache (
    marketplace_id,
    product_type,
    requirements,
    COALESCE(requirements_enforced, ''),
    COALESCE(locale, 'en_US'),
    COALESCE(seller_account_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_amazon_ptd_cache_unique
  ON public.amazon_product_type_cache (
    marketplace_id,
    product_type,
    requirements,
    COALESCE(requirements_enforced, ''),
    COALESCE(locale, 'en_US'),
    COALESCE(seller_account_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

-- ── updated_at triggers ──────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'amazon_seller_accounts',
    'amazon_auth_tokens',
    'amazon_marketplaces',
    'amazon_listings',
    'amazon_listing_mappings',
    'amazon_listing_drafts',
    'amazon_listing_issues',
    'amazon_push_queue',
    'amazon_product_type_cache'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_updated_at ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_updated_at
       BEFORE UPDATE ON public.%I
       FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()',
      t, t
    );
  END LOOP;
END $$;

-- ════════════════════════════════════════════════════════════════
-- Row Level Security
-- ════════════════════════════════════════════════════════════════

ALTER TABLE public.amazon_seller_accounts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amazon_auth_tokens          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amazon_marketplaces         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amazon_listings             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amazon_listing_mappings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amazon_listing_drafts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amazon_sync_runs            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amazon_sync_errors          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amazon_listing_issues       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amazon_push_queue           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amazon_product_type_cache   ENABLE ROW LEVEL SECURITY;

-- service_role: full access on all Amazon tables
CREATE POLICY amazon_seller_accounts_service_role_all
  ON public.amazon_seller_accounts FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY amazon_auth_tokens_service_role_all
  ON public.amazon_auth_tokens FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY amazon_marketplaces_service_role_all
  ON public.amazon_marketplaces FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY amazon_listings_service_role_all
  ON public.amazon_listings FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY amazon_listing_mappings_service_role_all
  ON public.amazon_listing_mappings FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY amazon_listing_drafts_service_role_all
  ON public.amazon_listing_drafts FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY amazon_sync_runs_service_role_all
  ON public.amazon_sync_runs FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY amazon_sync_errors_service_role_all
  ON public.amazon_sync_errors FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY amazon_listing_issues_service_role_all
  ON public.amazon_listing_issues FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY amazon_push_queue_service_role_all
  ON public.amazon_push_queue FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY amazon_product_type_cache_service_role_all
  ON public.amazon_product_type_cache FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- authenticated: read operational data (admin UI reads in Phase 2G+)
CREATE POLICY amazon_seller_accounts_authenticated_select
  ON public.amazon_seller_accounts FOR SELECT TO authenticated
  USING (true);

CREATE POLICY amazon_marketplaces_authenticated_select
  ON public.amazon_marketplaces FOR SELECT TO authenticated
  USING (true);

CREATE POLICY amazon_listings_authenticated_select
  ON public.amazon_listings FOR SELECT TO authenticated
  USING (true);

CREATE POLICY amazon_sync_runs_authenticated_select
  ON public.amazon_sync_runs FOR SELECT TO authenticated
  USING (true);

CREATE POLICY amazon_sync_errors_authenticated_select
  ON public.amazon_sync_errors FOR SELECT TO authenticated
  USING (true);

CREATE POLICY amazon_listing_issues_authenticated_select
  ON public.amazon_listing_issues FOR SELECT TO authenticated
  USING (true);

CREATE POLICY amazon_push_queue_authenticated_select
  ON public.amazon_push_queue FOR SELECT TO authenticated
  USING (true);

CREATE POLICY amazon_product_type_cache_authenticated_select
  ON public.amazon_product_type_cache FOR SELECT TO authenticated
  USING (true);

-- authenticated: read/write mapping + drafts (admin workflows in later phases)
CREATE POLICY amazon_listing_mappings_authenticated_all
  ON public.amazon_listing_mappings FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY amazon_listing_drafts_authenticated_all
  ON public.amazon_listing_drafts FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- amazon_auth_tokens: NO authenticated/anon policies (service_role only)

-- ── Grants ───────────────────────────────────────────────────────
GRANT ALL ON public.amazon_seller_accounts      TO service_role;
GRANT ALL ON public.amazon_auth_tokens          TO service_role;
GRANT ALL ON public.amazon_marketplaces         TO service_role;
GRANT ALL ON public.amazon_listings             TO service_role;
GRANT ALL ON public.amazon_listing_mappings     TO service_role;
GRANT ALL ON public.amazon_listing_drafts       TO service_role;
GRANT ALL ON public.amazon_sync_runs            TO service_role;
GRANT ALL ON public.amazon_sync_errors          TO service_role;
GRANT ALL ON public.amazon_listing_issues       TO service_role;
GRANT ALL ON public.amazon_push_queue           TO service_role;
GRANT ALL ON public.amazon_product_type_cache   TO service_role;

GRANT SELECT ON public.amazon_seller_accounts      TO authenticated;
GRANT SELECT ON public.amazon_marketplaces         TO authenticated;
GRANT SELECT ON public.amazon_listings             TO authenticated;
GRANT SELECT ON public.amazon_listing_mappings     TO authenticated;
GRANT SELECT ON public.amazon_listing_drafts       TO authenticated;
GRANT SELECT ON public.amazon_sync_runs            TO authenticated;
GRANT SELECT ON public.amazon_sync_errors          TO authenticated;
GRANT SELECT ON public.amazon_listing_issues       TO authenticated;
GRANT SELECT ON public.amazon_push_queue           TO authenticated;
GRANT SELECT ON public.amazon_product_type_cache   TO authenticated;

GRANT INSERT, UPDATE, DELETE ON public.amazon_listing_mappings TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.amazon_listing_drafts   TO authenticated;

REVOKE ALL ON public.amazon_auth_tokens FROM authenticated;
REVOKE ALL ON public.amazon_auth_tokens FROM anon;

-- ════════════════════════════════════════════════════════════════
-- Read model: v_amazon_listing_workspace
-- Mirrors v_ebay_listing_workspace pattern for Synced Listings tab.
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW public.v_amazon_listing_workspace AS
WITH
variant_stats AS (
  SELECT
    product_id,
    COALESCE(SUM(COALESCE(stock, 0)) FILTER (WHERE is_active), 0) AS kk_stock_total
  FROM public.product_variants
  GROUP BY product_id
),
mapped AS (
  SELECT DISTINCT ON (m.amazon_listing_id)
    m.amazon_listing_id,
    m.id                AS mapping_id,
    m.kk_product_id,
    m.kk_sku,
    m.mapping_status,
    m.mapping_confidence,
    m.mapped_at
  FROM public.amazon_listing_mappings m
  WHERE m.mapping_status = 'mapped'
  ORDER BY m.amazon_listing_id, m.mapped_at DESC NULLS LAST, m.created_at DESC
),
issue_stats AS (
  SELECT
    i.amazon_listing_id,
    COUNT(*) FILTER (WHERE i.status = 'open') AS open_issue_count,
    MAX(
      CASE i.severity
        WHEN 'error'   THEN 3
        WHEN 'warning' THEN 2
        WHEN 'info'    THEN 1
        ELSE 0
      END
    ) FILTER (WHERE i.status = 'open') AS highest_issue_severity_rank
  FROM public.amazon_listing_issues i
  WHERE i.amazon_listing_id IS NOT NULL
  GROUP BY i.amazon_listing_id
)
SELECT
  al.id                          AS amazon_listing_id,
  al.seller_account_id,
  al.seller_id,
  al.marketplace_id,
  al.asin,
  al.seller_sku,
  al.amazon_title,
  al.product_type,
  al.listing_status,
  al.listing_status_buyable,
  al.listing_status_discoverable,
  al.price,
  al.currency,
  al.fulfillment_channel,
  al.fbm_quantity,
  al.fba_fulfillable_quantity,
  al.fba_reserved_quantity,
  al.fba_inbound_quantity,
  al.last_synced_at,
  mp.mapping_status,
  mp.mapping_confidence,
  mp.kk_product_id,
  COALESCE(mp.kk_sku, p.code)     AS kk_sku,
  p.name                          AS kk_product_title,
  p.price                         AS kk_price,
  COALESCE(vs.kk_stock_total, 0)  AS kk_stock,
  COALESCE(ist.open_issue_count, 0) AS open_issue_count,
  CASE COALESCE(ist.highest_issue_severity_rank, 0)
    WHEN 3 THEN 'error'
    WHEN 2 THEN 'warning'
    WHEN 1 THEN 'info'
    ELSE NULL
  END                             AS highest_issue_severity
FROM public.amazon_listings al
LEFT JOIN mapped mp
  ON mp.amazon_listing_id = al.id
LEFT JOIN public.products p
  ON p.id = mp.kk_product_id
LEFT JOIN variant_stats vs
  ON vs.product_id = p.id
LEFT JOIN issue_stats ist
  ON ist.amazon_listing_id = al.id;

COMMENT ON VIEW public.v_amazon_listing_workspace IS
  'Denormalized Amazon listing workspace for Synced Listings admin tab. Joins mapped listings to KK products and open issue counts.';

GRANT SELECT ON public.v_amazon_listing_workspace TO authenticated, service_role;
