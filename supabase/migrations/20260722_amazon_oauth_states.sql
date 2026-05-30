-- Phase 2E.2 — OAuth CSRF state storage + Vault helper for LWA refresh tokens
-- See docs/pages/admin/amazon/ux/016_auth_start_callback_implementation.md

-- ════════════════════════════════════════════════════════════════
-- amazon_oauth_states (service_role only)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.amazon_oauth_states (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  state_hash      text        NOT NULL UNIQUE,
  created_by      uuid,
  region          text        NOT NULL DEFAULT 'na'
                  CHECK (region IN ('na', 'eu', 'fe')),
  marketplace_ids text[]      NOT NULL DEFAULT '{}',
  redirect_after  text,
  expires_at      timestamptz NOT NULL,
  used_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.amazon_oauth_states IS
  'Single-use OAuth CSRF state for Amazon LWA consent flow. Service role only; stores SHA-256 hash of state token, never raw state.';

CREATE INDEX IF NOT EXISTS idx_amazon_oauth_states_unused
  ON public.amazon_oauth_states (state_hash, expires_at)
  WHERE used_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_amazon_oauth_states_created_by
  ON public.amazon_oauth_states (created_by);

CREATE INDEX IF NOT EXISTS idx_amazon_oauth_states_expires
  ON public.amazon_oauth_states (expires_at);

ALTER TABLE public.amazon_oauth_states ENABLE ROW LEVEL SECURITY;

CREATE POLICY amazon_oauth_states_service_role_all
  ON public.amazon_oauth_states FOR ALL TO service_role
  USING (true) WITH CHECK (true);

GRANT ALL ON public.amazon_oauth_states TO service_role;

REVOKE ALL ON public.amazon_oauth_states FROM authenticated;
REVOKE ALL ON public.amazon_oauth_states FROM anon;

-- ════════════════════════════════════════════════════════════════
-- Vault helper: store LWA refresh token by seller account id
-- SECURITY DEFINER; callable only by service_role (edge functions).
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.amazon_store_lwa_refresh_token(
  p_seller_account_id uuid,
  p_refresh_token     text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, extensions
AS $$
DECLARE
  v_name      text := 'amazon_lwa_refresh_' || p_seller_account_id::text;
  v_secret_id uuid;
BEGIN
  IF p_seller_account_id IS NULL THEN
    RAISE EXCEPTION 'missing_seller_account_id';
  END IF;

  IF p_refresh_token IS NULL OR length(trim(p_refresh_token)) = 0 THEN
    RAISE EXCEPTION 'missing_refresh_token';
  END IF;

  SELECT id INTO v_secret_id
  FROM vault.secrets
  WHERE name = v_name
  LIMIT 1;

  IF v_secret_id IS NULL THEN
    PERFORM vault.create_secret(
      p_refresh_token,
      v_name,
      'Amazon SP-API LWA refresh token'
    );
  ELSE
    PERFORM vault.update_secret(v_secret_id, p_refresh_token);
  END IF;

  RETURN v_name;
END;
$$;

COMMENT ON FUNCTION public.amazon_store_lwa_refresh_token(uuid, text) IS
  'Upsert Amazon LWA refresh token in Supabase Vault. Returns vault secret name for amazon_auth_tokens.vault_secret_name.';

REVOKE ALL ON FUNCTION public.amazon_store_lwa_refresh_token(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.amazon_store_lwa_refresh_token(uuid, text) TO service_role;
