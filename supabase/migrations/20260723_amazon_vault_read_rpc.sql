-- Phase 2F — Read-only sync: service-role Vault read for LWA refresh token
-- See docs/pages/admin/amazon/ux/018_read_only_sync_prototype.md

CREATE OR REPLACE FUNCTION public.amazon_get_lwa_refresh_token(
  p_seller_account_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, extensions
AS $$
DECLARE
  v_secret_name   text;
  v_refresh_token text;
BEGIN
  IF p_seller_account_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT t.vault_secret_name
  INTO v_secret_name
  FROM public.amazon_auth_tokens t
  WHERE t.seller_account_id = p_seller_account_id
    AND t.token_status = 'active'
    AND t.vault_secret_name IS NOT NULL
  LIMIT 1;

  IF v_secret_name IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT ds.decrypted_secret
  INTO v_refresh_token
  FROM vault.decrypted_secrets ds
  WHERE ds.name = v_secret_name
  LIMIT 1;

  RETURN v_refresh_token;
END;
$$;

COMMENT ON FUNCTION public.amazon_get_lwa_refresh_token(uuid) IS
  'Returns LWA refresh token from Vault for active amazon_auth_tokens row. service_role only.';

REVOKE ALL ON FUNCTION public.amazon_get_lwa_refresh_token(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.amazon_get_lwa_refresh_token(uuid) TO service_role;
