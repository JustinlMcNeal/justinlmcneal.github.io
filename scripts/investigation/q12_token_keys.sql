SELECT setting_key,
  (setting_value IS NOT NULL AND setting_value::text NOT IN ('null','""','{}')) AS has_value,
  CASE
    WHEN setting_key LIKE '%expires%' THEN setting_value::text
    WHEN setting_key LIKE '%connected%' THEN (setting_value->>'connected')
    ELSE 'redacted'
  END AS safe_meta
FROM social_settings
WHERE setting_key IN (
  'instagram_access_token','instagram_user_id','instagram_token_expires_at',
  'facebook_access_token','facebook_page_id','facebook_token_expires_at',
  'pinterest_access_token','pinterest_refresh_token','pinterest_token_expires_at'
)
ORDER BY setting_key;
