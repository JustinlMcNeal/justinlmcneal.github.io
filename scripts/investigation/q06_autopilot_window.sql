SELECT COUNT(*)::int AS queued_draft_tomorrow_plus_3d
FROM social_posts
WHERE status IN ('queued','draft')
  AND scheduled_for >= date_trunc('day', now() AT TIME ZONE 'utc') + interval '1 day'
  AND scheduled_for < date_trunc('day', now() AT TIME ZONE 'utc') + interval '4 days';
