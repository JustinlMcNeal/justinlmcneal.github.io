SELECT status, COUNT(*)::int AS cnt FROM social_posts GROUP BY status ORDER BY cnt DESC;
