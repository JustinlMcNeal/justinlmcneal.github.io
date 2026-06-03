SELECT setting_key,
  (setting_value->>'connected')::text AS connected,
  ((setting_value->'access_token') IS NOT NULL) AS has_access_token,
  ((setting_value->'token_expires_at') IS NOT NULL) AS has_expiry
FROM social_settings
WHERE setting_key IN ('instagram_connected','facebook_connected','pinterest_connected')
ORDER BY 1;
