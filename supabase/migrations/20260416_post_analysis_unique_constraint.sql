-- Add unique constraint on post_id for post_performance_analysis
-- Allows upsert (re-analyzing the same post updates rather than creating duplicates)
ALTER TABLE post_performance_analysis ADD CONSTRAINT post_performance_analysis_post_id_key UNIQUE (post_id);
