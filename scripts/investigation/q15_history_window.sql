SELECT id, platform, status, scheduled_for,
  LEFT(error_message,60) AS err
FROM social_posts
WHERE scheduled_for >= '2026-05-19'::timestamptz
  AND scheduled_for < '2026-05-25'::timestamptz
ORDER BY scheduled_for DESC LIMIT 25;
