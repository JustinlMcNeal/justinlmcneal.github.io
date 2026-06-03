SELECT j.jobname, d.status, d.start_time,
  LEFT(COALESCE(d.return_message,''), 200) AS return_preview
FROM cron.job_run_details d
JOIN cron.job j ON j.jobid = d.jobid
WHERE (j.jobname ILIKE '%process%scheduled%' OR j.command ILIKE '%process-scheduled%')
  AND d.start_time >= now() - interval '48 hours'
  AND (d.return_message ILIKE '%fail%' OR d.return_message ILIKE '%error%' OR d.status = 'failed')
ORDER BY d.start_time DESC LIMIT 15;
