SELECT id, platform, status, scheduled_for,
  LEFT(COALESCE(error_message,''), 250) AS error_preview
FROM social_posts
WHERE status = 'failed' AND scheduled_for >= now() - interval '7 days'
ORDER BY scheduled_for DESC LIMIT 15;
