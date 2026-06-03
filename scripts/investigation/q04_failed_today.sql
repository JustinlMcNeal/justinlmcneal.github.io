SELECT id, platform, status, scheduled_for, posted_at, updated_at,
  LEFT(COALESCE(error_message,''), 250) AS error_preview,
  pinterest_board_id,
  (image_url IS NOT NULL) AS has_image
FROM social_posts
WHERE scheduled_for >= date_trunc('day', now() AT TIME ZONE 'utc')
  AND scheduled_for < date_trunc('day', now() AT TIME ZONE 'utc') + interval '1 day'
ORDER BY scheduled_for;
