-- Seed NA marketplaces used by KK admin (MX seller + toolbar filters).

INSERT INTO public.amazon_marketplaces (
  marketplace_id, country_code, name, domain, region, is_enabled
) VALUES
  ('A2EUQ1WTGCTBG2', 'CA', 'Amazon.ca', 'amazon.ca', 'na', true),
  ('A1AM78C64UM0Y8', 'MX', 'Amazon.com.mx', 'amazon.com.mx', 'na', true)
ON CONFLICT (marketplace_id) DO UPDATE SET
  country_code = EXCLUDED.country_code,
  name = EXCLUDED.name,
  domain = EXCLUDED.domain,
  region = EXCLUDED.region,
  is_enabled = EXCLUDED.is_enabled;
