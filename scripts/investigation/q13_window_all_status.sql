SELECT status, COUNT(*)::int AS cnt
FROM social_posts
WHERE scheduled_for >= date_trunc('day', now() AT TIME ZONE 'utc') + interval '1 day'
  AND scheduled_for < date_trunc('day', now() AT TIME ZONE 'utc') + interval '4 days'
GROUP BY status ORDER BY cnt DESC;
