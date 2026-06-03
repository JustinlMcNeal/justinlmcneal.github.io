SELECT id, platform, status, scheduled_for, LEFT(error_message,80) AS err
FROM social_posts
WHERE scheduled_for >= now() - interval '14 days'
  AND status IN ('queued','draft','processing','scheduled')
ORDER BY scheduled_for DESC LIMIT 20;
