SELECT j.jobname, d.status, d.start_time, d.end_time,
  LEFT(COALESCE(d.return_message,''), 400) AS return_preview
FROM cron.job_run_details d
JOIN cron.job j ON j.jobid = d.jobid
WHERE j.jobname ILIKE '%autopilot%'
  AND d.start_time >= now() - interval '10 days'
ORDER BY d.start_time DESC LIMIT 20;
